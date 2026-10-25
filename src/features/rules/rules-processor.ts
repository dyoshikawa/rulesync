import { basename, dirname, join, posix, relative, sep } from "node:path";

import { encode } from "@toon-format/toon";
import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  CURATED_RULES_FEATURE_SUBDIR,
  RULES_FEATURE_SUBDIR,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { WARP_LEGACY_RULE_FILE_NAME } from "../../constants/warp-paths.js";
import {
  caseFoldIdentity,
  FeatureProcessor,
  formatCuratedCaseCollisionWarning,
  groupSpellingsByCaseFoldedIdentity,
  mergeByCaseInsensitiveIdentity,
} from "../../types/feature-processor.js";
import type { FeatureOptions } from "../../types/features.js";
import { Language, appendLanguageBlock, stripLanguageBlock } from "../../types/language.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { TOOL_DISPLAY } from "../../types/tool-display.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import {
  addTrailingNewline,
  checkPathTraversal,
  directoryExistsStrict,
  fileExists,
  filterOutPathsInGitIgnoredDirectories,
  findFilesByGlobs,
  readFileContent,
  resolvedRelativePath,
  toPosixPath,
} from "../../utils/file.js";
import { type Logger, warnOnceWithFallback } from "../../utils/logger.js";
import { CommandsProcessor } from "../commands/commands-processor.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { SkillsProcessor } from "../skills/skills-processor.js";
import { SubagentsProcessor } from "../subagents/subagents-processor.js";
import { ClaudecodeLanguageSettings } from "./claudecode-language-settings.js";
import {
  normalizeRelativeDir,
  toInstructionBudgetFile,
  findProjectInstructionBudgetFindings,
} from "./instruction-budget.js";
import { RovodevRule } from "./rovodev-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  RulesProcessorToolTarget,
  RulesProcessorToolTargetSchema,
  RuleDiscoveryMode,
  RuleCollisionPolicy,
  ToolRuleFactory,
  toolRuleFactories,
} from "./tool-rule-factories.js";
import { ToolRule, ToolRuleExtraFixedFile } from "./tool-rule.js";

/** A tool rule's output path relative to its output root, for comparison. */
const toolOutputPath = (toolRule: ToolRule): string =>
  posix.join(normalizeRelativeDir(toolRule.getRelativeDirPath()), toolRule.getRelativeFilePath());

const formatRulePaths = (rules: RulesyncRule[]): string =>
  rules.map((r) => join(r.getRelativeDirPath(), r.getRelativeFilePath())).join(", ");

/**
 * The leading `---` frontmatter block (with its closing delimiter line) that
 * every one of `contents` starts with, or `undefined` when one lacks it or the
 * blocks differ.
 */
const findSharedLeadingFrontmatter = (contents: string[]): string | undefined => {
  const blocks = contents.map(
    (content) => /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)?.[0],
  );
  const first = blocks[0];
  return first !== undefined && blocks.every((block) => block === first) ? first : undefined;
};

/**
 * Whether a group of rules colliding on one output path is composed into one
 * file, and the frontmatter block the composed file keeps, if any.
 */
const decideRuleComposition = ({
  group,
  collisionPolicy,
}: {
  group: RuleConversion[];
  collisionPolicy: RuleCollisionPolicy;
}): { shouldCompose: boolean; sharedRootFrontmatter: string | undefined } => {
  const contents = group.map(({ toolRule }) => toolRule.getFileContent());
  const allGeneratedRulesAreRoots = group.every(({ toolRule }) => toolRule.isRoot());
  // Composition is only structure-preserving when every fragment is plain
  // Markdown. An adapter may prepend a frontmatter block to some outputs
  // (Amp gates non-root files on a leading `globs:` block); concatenating
  // such a fragment would bury its block mid-body where the tool no longer
  // reads it, so those groups fall through to preserve-or-reject instead.
  const allFragmentsArePlain = contents.every((content) => !/^---\r?\n/.test(content));
  // A root file that an adapter always writes with the same fixed
  // frontmatter (Antigravity's plugin `rules/AGENTS.md`) composes too: the
  // block is kept once at the top and only the bodies are concatenated.
  const sharedRootFrontmatter = allGeneratedRulesAreRoots
    ? findSharedLeadingFrontmatter(contents)
    : undefined;
  const shouldCompose =
    ((collisionPolicy === "fold" || collisionPolicy === "compose" || allGeneratedRulesAreRoots) &&
      allFragmentsArePlain) ||
    sharedRootFrontmatter !== undefined;
  return { shouldCompose, sharedRootFrontmatter };
};

/**
 * Concatenate colliding rule fragments. With `sharedFrontmatter` (the block
 * every fragment starts with), the block is stripped from each fragment and
 * written once at the top.
 */
const composeRuleFragments = ({
  contents,
  sharedFrontmatter,
}: {
  contents: string[];
  sharedFrontmatter: string | undefined;
}): string => {
  const merged = contents
    .map((content) => content.slice(sharedFrontmatter?.length ?? 0).trim())
    .filter((content) => content.length > 0)
    .join("\n\n");
  return sharedFrontmatter === undefined ? merged : `${sharedFrontmatter}${merged}\n`;
};

const RulesFeatureOptionsSchema = z.looseObject({
  ruleDiscoveryMode: z.optional(z.enum(["none", "explicit"])),
  includeLocalRoot: z.optional(z.boolean()),
  includeRoot: z.optional(z.boolean()),
});

const resolveRuleDiscoveryMode = ({
  defaultMode,
  options,
}: {
  defaultMode: RuleDiscoveryMode;
  options?: FeatureOptions;
}): RuleDiscoveryMode => {
  if (defaultMode === "claudecode-legacy") {
    return defaultMode;
  }
  if (!options) return defaultMode;
  const parsed = RulesFeatureOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      `Invalid options for rules feature: ${parsed.error.message}. ` +
        '`ruleDiscoveryMode` must be either "none" or "explicit".',
    );
  }
  if (!parsed.data.ruleDiscoveryMode) {
    return defaultMode;
  }
  return parsed.data.ruleDiscoveryMode === "none" ? "auto" : "toon";
};

const IncludeLocalRootSchema = z.looseObject({
  includeLocalRoot: z.optional(z.boolean()),
});

const resolveIncludeLocalRoot = (options?: FeatureOptions): boolean => {
  if (!options) return true;
  const parsed = IncludeLocalRootSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      `Invalid options for rules feature: ${parsed.error.message}. ` +
        "`includeLocalRoot` must be a boolean.",
    );
  }
  return parsed.data.includeLocalRoot ?? true;
};

const IncludeRootSchema = z.looseObject({
  includeRoot: z.optional(z.boolean()),
});

const resolveIncludeRoot = (options?: FeatureOptions): boolean => {
  if (!options) return true;
  const parsed = IncludeRootSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      `Invalid options for rules feature: ${parsed.error.message}. ` +
        "`includeRoot` must be a boolean.",
    );
  }
  return parsed.data.includeRoot ?? true;
};

type RuleConversion = {
  toolRule: ToolRule;
  rulesyncRule: RulesyncRule;
};

const allToolTargetKeys = [...toolRuleFactories.keys()];

const rulesProcessorToolTargets: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolRuleFactories.get(target);
  return factory?.meta.supportsProject !== false;
});

const rulesProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolRuleFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: RulesProcessorToolTarget) => ToolRuleFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolRuleFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

/**
 * How many skipped import-only paths a single warning names before it
 * summarizes the rest. Keeps one line readable when a rules directory holds
 * dozens of files.
 */
const MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS = 10;

/**
 * Fall back to a tool's legacy roots when its primary root file is absent.
 *
 * The primary hits are passed in rather than globbed here, so that callers
 * which need "the root file Rulesync generates" — rather than "whatever root
 * the tool will read" — can keep the two apart. A legacy root is a file
 * Rulesync reads but never writes, and the difference matters to them.
 */
const findFilesWithFallback = async (
  primaryFilePaths: string[],
  alternativeRoots: Array<{ relativeDirPath: string; relativeFilePath: string }> | undefined,
  buildAltGlob: (alt: { relativeDirPath: string; relativeFilePath: string }) => string,
  outputRoot: string,
): Promise<string[]> => {
  if (primaryFilePaths.length > 0) {
    return primaryFilePaths;
  }
  if (alternativeRoots) {
    return await findFilesByGlobs(alternativeRoots.map(buildAltGlob), { cwd: outputRoot });
  }
  return [];
};

/**
 * A project-root-relative glob for a file a tool keeps at a fixed path, joined
 * with `/` because a glob is always posix-separated.
 *
 * Relative because the root goes to `findFilesByGlobs` as `cwd` rather than into
 * the pattern: a project directory named `project(a)` or `project{a,b}` would
 * otherwise be read as a glob and match nothing at all — and on a `--delete`
 * sweep an empty result reads as "every source was removed", so rulesync would
 * delete generated files it can no longer regenerate and report success.
 */
const rootRelativeGlob = (...segments: Array<string | undefined>): string =>
  posix.join(...segments.filter((segment) => segment !== undefined).map(toPosixPath));

const isRootRule = (rule: RulesyncRule): boolean =>
  Boolean(rule.getFrontmatter().root || rule.getFrontmatter().localRoot);

export class RulesProcessor extends FeatureProcessor {
  private readonly toolTarget: RulesProcessorToolTarget;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly language: Language | undefined;
  private readonly deriveSubprojectPathFromGlobs: boolean;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;
  private readonly skills?: RulesyncSkill[];
  private readonly featureOptions?: FeatureOptions;
  private readonly deleteOrphans: boolean;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    simulateCommands = false,
    simulateSubagents = false,
    simulateSkills = false,
    language,
    deriveSubprojectPathFromGlobs = false,
    global = false,
    getFactory = defaultGetFactory,
    skills,
    featureOptions,
    delete: deleteOrphans = false,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    simulateCommands?: boolean;
    simulateSubagents?: boolean;
    simulateSkills?: boolean;
    /**
     * The root `language` key of `rulesync.jsonc`. Claude Code targets get it
     * as a native setting; every other target gets a prompt block appended to
     * the generated root rule file. Unset leaves both alone.
     */
    language?: Language;
    /**
     * Resolve `agentsmd.subprojectPath` from `globs` for every non-root rule
     * loaded from the source trees (the `deriveSubprojectPathFromGlobs` config
     * option). Applied where the rules are read, so every target sees the same
     * resolved path.
     */
    deriveSubprojectPathFromGlobs?: boolean;
    getFactory?: GetFactory;
    skills?: RulesyncSkill[];
    featureOptions?: FeatureOptions;
    /**
     * Whether the run sweeps orphaned tool files (the `delete` config option).
     * Only consulted to decide which leftover root files `includeRoot: false`
     * has to report during conversion: with `delete` on, the sweep removes the
     * project-root `CLAUDE.md` / `CLAUDE.local.md` and reports the rest.
     */
    delete?: boolean;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoots, dryRun, logger });
    const result = RulesProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for RulesProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.simulateCommands = simulateCommands;
    this.simulateSubagents = simulateSubagents;
    this.simulateSkills = simulateSkills;
    this.language = language;
    this.deriveSubprojectPathFromGlobs = deriveSubprojectPathFromGlobs;
    this.getFactory = getFactory;
    this.skills = skills;
    this.featureOptions = featureOptions;
    this.deleteOrphans = deleteOrphans;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncRules = rulesyncFiles.filter(
      (file): file is RulesyncRule => file instanceof RulesyncRule,
    );

    const alignedRules = this.alignPiContextFile(rulesyncRules);
    const factory = this.getFactory(this.toolTarget);
    const { meta } = factory;
    this.warnForIncludeRootOption(meta);
    this.warnForOutputStyleRuleOptions({ rules: alignedRules, factory });
    const emittedRules = this.omitsRootFiles()
      ? await this.dropRootRules(alignedRules)
      : alignedRules;

    // Separate localRoot rules from normal rules
    const localRootRules = emittedRules.filter((rule) => rule.getFrontmatter().localRoot);
    const nonLocalRootRules = emittedRules.filter((rule) => !rule.getFrontmatter().localRoot);

    const convertedRules = nonLocalRootRules
      .map((rulesyncRule) => {
        if (!factory.class.isTargetedByRulesyncRule(rulesyncRule)) {
          return null;
        }
        const toolRule = factory.class.fromRulesyncRule({
          outputRoot: this.outputRoot,
          rulesyncRule,
          validate: true,
          global: this.global,
        });
        return { toolRule, rulesyncRule };
      })
      .filter((rule): rule is RuleConversion => rule !== null);

    this.mergeRulesByOutputPath({
      convertedRules,
      collisionPolicy: meta.collisionPolicy ?? "preserve",
    });
    const toolRules = convertedRules.map(({ toolRule }) => toolRule);

    this.applyLocalRootRules({ toolRules, localRootRules, factory });

    this.appendSeparateConventionsRule({ toolRules, factory });

    const extraFiles = await this.buildMcpInstructionFiles({ toolRules, meta });

    this.applyRootRuleSections({ toolRules, factory, convertedRules });

    extraFiles.push(...(await this.buildLanguageSettingsFiles()));

    const outputFiles = [...toolRules, ...extraFiles];
    this.warnForOutputPathCollisions({ outputFiles, convertedRules });
    await this.warnForDeactivatedImportOnlyRoots({ toolRules, factory });
    await this.warnForWarpLegacyRootFile(toolRules);
    await this.warnForInstructionBudget({ toolRules, meta });
    return outputFiles;
  }

  /**
   * Warn when a generated project instruction chain exceeds the tool's byte
   * budget (`meta.projectInstructionBudget`); see
   * {@link findProjectInstructionBudgetFindings} for what is measured. Global
   * scope is not checked because Codex loads the personal `~/.codex/AGENTS.md`
   * outside the project budget.
   */
  private async warnForInstructionBudget({
    toolRules,
    meta,
  }: {
    toolRules: ToolRule[];
    meta: ToolRuleFactory["meta"];
  }): Promise<void> {
    const budget = meta.projectInstructionBudget;
    if (budget === undefined || this.global) {
      return;
    }
    const findings = await findProjectInstructionBudgetFindings({
      toolTarget: this.toolTarget,
      budget,
      outputRoot: this.outputRoot,
      // Measure what is written: the writer normalizes the trailing newline.
      files: toolRules.map((rule) =>
        toInstructionBudgetFile(rule, addTrailingNewline(rule.getFileContent())),
      ),
    });
    for (const { message, remedy } of findings) {
      this.logger.warn(remedy === undefined ? message : `${message} ${remedy}`);
    }
  }

  /**
   * Handle localRoot rules (only in non-global mode and when enabled). Mutates
   * `toolRules` in place.
   */
  private applyLocalRootRules({
    toolRules,
    localRootRules,
    factory,
  }: {
    toolRules: ToolRule[];
    localRootRules: RulesyncRule[];
    factory: ToolRuleFactory;
  }): void {
    const includeLocalRoot = resolveIncludeLocalRoot(this.featureOptions);
    if (localRootRules.length === 0 || this.global || !includeLocalRoot) {
      return;
    }
    const localRootRule = localRootRules[0];
    if (localRootRule && factory.class.isTargetedByRulesyncRule(localRootRule)) {
      this.handleLocalRootRule(toolRules, localRootRule, factory);
    }
  }

  /**
   * For tools that create a separate conventions rule file (e.g., cursor, roo),
   * push that rule onto `toolRules`. Mutates `toolRules` in place.
   */
  private appendSeparateConventionsRule({
    toolRules,
    factory,
  }: {
    toolRules: ToolRule[];
    factory: ToolRuleFactory;
  }): void {
    const { meta } = factory;
    const isSimulated = this.simulateCommands || this.simulateSubagents || this.simulateSkills;
    if (!isSimulated || !meta.createsSeparateConventionsRule || !meta.additionalConventions) {
      return;
    }

    const conventionsContent = this.generateAdditionalConventionsSectionFromMeta(meta);
    const settablePaths = factory.class.getSettablePaths();
    const nonRootPath = "nonRoot" in settablePaths ? settablePaths.nonRoot : null;
    if (!nonRootPath) {
      return;
    }
    // Use .md extension - CursorRule.fromRulesyncRule will convert to .mdc
    toolRules.push(
      factory.class.fromRulesyncRule({
        outputRoot: this.outputRoot,
        rulesyncRule: new RulesyncRule({
          outputRoot: this.outputRoot,
          relativeDirPath: nonRootPath.relativeDirPath,
          relativeFilePath: "additional-conventions.md",
          frontmatter: {
            root: false,
            targets: [this.toolTarget],
          },
          body: conventionsContent,
        }),
        validate: true,
        global: this.global,
      }),
    );
  }

  /**
   * Non-root rules of some tools are not auto-loaded; the tool's MCP feature
   * registers them in its shared config's `instructions` key. The root rule is
   * auto-loaded and never registered. Global scope opt-in via
   * `mcpInstructionsRegistrarGlobal`.
   */
  private async buildMcpInstructionFiles({
    toolRules,
    meta,
  }: {
    toolRules: ToolRule[];
    meta: ToolRuleFactory["meta"];
  }): Promise<ToolFile[]> {
    if (!meta.mcpInstructionsRegistrar || (this.global && !meta.mcpInstructionsRegistrarGlobal)) {
      return [];
    }
    const instructionPaths = toolRules
      .filter((rule) => !rule.isRoot() && !rule.isExcludedFromRootReferences())
      .map((rule) => toPosixPath(join(rule.getRelativeDirPath(), rule.getRelativeFilePath())));
    // The registrar runs even with an empty list: it owns the managed subset
    // of the `instructions` array, so deleting the LAST non-root rule must
    // still clear its stale registrations (the registrar itself avoids
    // creating a config file just to hold an empty payload).
    const registered = await meta.mcpInstructionsRegistrar.fromInstructions({
      outputRoot: this.outputRoot,
      instructions: instructionPaths,
      validate: true,
      global: this.global,
      logger: this.logger,
    });
    return registered ? [registered] : [];
  }

  /**
   * For tools that don't create a separate conventions rule, prepend the
   * reference and conventions sections to the root rule content. Mutates the
   * root rule in place.
   */
  private applyRootRuleSections({
    toolRules,
    factory,
    convertedRules,
  }: {
    toolRules: ToolRule[];
    factory: ToolRuleFactory;
    convertedRules: RuleConversion[];
  }): void {
    const { meta } = factory;
    // Fixed-root targets were collapsed by mergeRulesByOutputPath. Targets that
    // keep multiple native paths emit those ToolRules as non-root, so at most
    // one root rule can survive here.
    const rootRule = toolRules.find((rule) => rule.isRoot());
    if (!rootRule) {
      this.appendLanguageBlockToRootSourceRules({ convertedRules });
      return;
    }

    const referenceSection = this.generateReferenceSectionFromMeta(meta, toolRules);

    const conventionsSection =
      !meta.createsSeparateConventionsRule && meta.additionalConventions
        ? this.generateAdditionalConventionsSectionFromMeta(meta)
        : "";

    const assembledContent = referenceSection + conventionsSection + rootRule.getFileContent();
    // Appended last so the block closes the file (and its root mirrors) after
    // every section rulesync composes, never between them.
    const promptLanguage = this.getPromptBlockLanguage();
    const newContent =
      promptLanguage === undefined
        ? assembledContent
        : appendLanguageBlock({ content: assembledContent, language: promptLanguage });
    rootRule.setFileContent(newContent);

    const rootMirror = factory.class.getRootMirror?.();
    if (rootMirror && !this.global) {
      toolRules.push(
        ...rootMirror.getMirrorFiles({
          outputRoot: this.outputRoot,
          rootRule,
          content: newContent,
        }),
      );
    }
  }

  /**
   * The language delivered as a prompt block, or `undefined` when none is:
   * `language` is unset, or the target is Claude Code, which has a native
   * `language` setting (see {@link ClaudecodeLanguageSettings}) and so gets
   * no block in its root file.
   */
  private getPromptBlockLanguage(): Language | undefined {
    return this.isClaudecodeTarget() ? undefined : this.language;
  }

  /**
   * `includeRoot: false` on the `claudecode` target (project scope only)
   * drops the root `CLAUDE.md` and the personal `CLAUDE.local.md`, keeping the
   * non-root `.claude/rules/*.md`. Claude Code falls back to `AGENTS.md` only
   * when none of `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists,
   * so emitting either root file would shadow an `AGENTS.md` written by another
   * target. With `delete` on, stale root files are swept by the regular orphan
   * deletion because they are no longer part of the generated output; without
   * it, conversion warns about them instead. Global scope keeps the
   * root file: `~/.claude/CLAUDE.md` never shadows `AGENTS.md`, and Claude Code
   * reads no global `AGENTS.md` to fall back to. `claudecode-legacy` is not
   * covered: its `.claude/memories/*.md` are only reachable through the
   * references listed in the root file.
   * @see https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md
   */
  private omitsRootFiles(): boolean {
    return (
      this.toolTarget === "claudecode" && !this.global && !resolveIncludeRoot(this.featureOptions)
    );
  }

  /**
   * Warn when `includeRoot: false` is set where it has no effect, or where it
   * silently disables another option that writes into the root file.
   */
  private warnForIncludeRootOption(meta: ToolRuleFactory["meta"]): void {
    if (resolveIncludeRoot(this.featureOptions)) {
      return;
    }
    if (this.toolTarget !== "claudecode") {
      this.logger.warn(
        `The rules option \`includeRoot\` is only supported by the claudecode target; ignoring it for ${this.toolTarget}.`,
      );
      return;
    }
    if (this.global) {
      this.logger.warn(
        "The rules option `includeRoot: false` has no effect in global mode: ~/.claude/CLAUDE.md does not shadow AGENTS.md, so it is still generated.",
      );
      return;
    }
    const mode = resolveRuleDiscoveryMode({
      defaultMode: meta.ruleDiscoveryMode,
      options: this.featureOptions,
    });
    if (mode !== "auto") {
      this.logger.warn(
        "The rules option `ruleDiscoveryMode` has no effect with `includeRoot: false` on claudecode: the rule references it adds are written into CLAUDE.md, which is not generated.",
      );
    }
  }

  /**
   * Warn about `factorydroid` / `qoder` frontmatter that does not do what it
   * looks like it does: an `output-style` rule that also targets other tools
   * reaches them as an ordinary rule (so presentation instructions end up in
   * their project rules), and `<tool>.name` is read only with
   * `channel: output-style`. Checked while generating for that tool only, so
   * each warning prints once.
   */
  private warnForOutputStyleRuleOptions({
    rules,
    factory,
  }: {
    rules: RulesyncRule[];
    factory: ToolRuleFactory;
  }): void {
    const toolTarget = this.toolTarget;
    if (toolTarget !== "factorydroid" && toolTarget !== "qoder") {
      return;
    }
    const toolLabel = TOOL_DISPLAY.find((entry) => entry.key === toolTarget)?.label ?? toolTarget;
    for (const rule of rules) {
      const frontmatter = rule.getFrontmatter();
      const section = frontmatter[toolTarget];
      if (frontmatter.root || !section || !factory.class.isTargetedByRulesyncRule(rule)) {
        continue;
      }
      const { channel, name } = section;
      const fileName = stripControlCharacters(rule.getRelativeFilePath());
      const targets = frontmatter.targets ?? ["*"];
      if (channel === "output-style" && targets.some((target) => target !== toolTarget)) {
        this.logger.warn(
          `${fileName} sets ${toolTarget}.channel: output-style but also targets other tools, which receive it as an ordinary rule. Set \`targets: ["${toolTarget}"]\` to keep the output style to ${toolLabel}.`,
        );
      }
      if (channel !== "output-style" && name !== undefined) {
        this.logger.warn(
          `${fileName} sets ${toolTarget}.name, which is read only with ${toolTarget}.channel: output-style; ignoring it.`,
        );
      }
    }
  }

  /**
   * Drop the root and local-root rules for `includeRoot: false`, reporting what
   * would otherwise go unnoticed: a dropped rule no other target emits, and a
   * root file on disk that keeps shadowing `AGENTS.md`. With `delete` on, the
   * orphan sweep removes the project-root files and reports the rest itself
   * (see {@link loadToolFiles}), so conversion only reports them when no sweep
   * runs.
   */
  private async dropRootRules(rules: RulesyncRule[]): Promise<RulesyncRule[]> {
    this.warnForClaudecodeOnlyRootRules(rules.filter(isRootRule));
    if (!this.deleteOrphans || this.hasRulesyncSourceLoadFailure()) {
      await this.warnForShadowingRootFiles({ includePrimaryRoots: true });
    }
    return rules.filter((rule) => !isRootRule(rule));
  }

  /**
   * A root or local-root rule that targets `claudecode` alone is dropped by
   * `includeRoot: false`, and no other target writes it either, so its content
   * would end up nowhere without a word.
   */
  private warnForClaudecodeOnlyRootRules(rootRules: RulesyncRule[]): void {
    for (const rule of rootRules) {
      const targets = rule.getFrontmatter().targets ?? ["*"];
      if (targets.length === 0 || !targets.every((target) => target === "claudecode")) {
        continue;
      }
      this.logger.warn(
        `${stripControlCharacters(rule.getRelativeFilePath())} is a root rule that targets only claudecode, so \`includeRoot: false\` drops it and no target generates its content. Add the target that writes AGENTS.md to its \`targets\`, or turn it into a non-root rule.`,
      );
    }
  }

  /**
   * With `includeRoot: false`, a root file still on disk keeps Claude Code
   * from reading `AGENTS.md`: a project-root `CLAUDE.md` or `CLAUDE.local.md`
   * (`includePrimaryRoots`), which only the `delete` sweep removes, and a
   * hand-authored `.claude/CLAUDE.md` at an alternative location, which
   * Rulesync never writes and so never deletes. `.claude/CLAUDE.local.md` is
   * not checked: it is not one of the files that shadow `AGENTS.md`.
   * @see https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md
   */
  private async warnForShadowingRootFiles({
    includePrimaryRoots,
  }: {
    includePrimaryRoots: boolean;
  }): Promise<void> {
    const factory = this.getFactory(this.toolTarget);
    const settablePaths = factory.class.getSettablePaths({ global: this.global });
    const primaryDirPath = settablePaths.root?.relativeDirPath ?? ".";
    const primaryFileNames =
      includePrimaryRoots && settablePaths.root
        ? [
            settablePaths.root.relativeFilePath,
            ...(factory.meta.localRootFileName ? [factory.meta.localRootFileName] : []),
          ]
        : [];
    const primaryGlobs = primaryFileNames.map((fileName) =>
      rootRelativeGlob(primaryDirPath, fileName),
    );
    const alternativeGlobs = (settablePaths.alternativeRoots ?? []).map((alt) =>
      rootRelativeGlob(alt.relativeDirPath, alt.relativeFilePath),
    );
    const primaryFilePaths =
      primaryGlobs.length > 0 ? await findFilesByGlobs(primaryGlobs, { cwd: this.outputRoot }) : [];
    const alternativeFilePaths =
      alternativeGlobs.length > 0
        ? await findFilesByGlobs(alternativeGlobs, { cwd: this.outputRoot })
        : [];
    const filePaths = [...primaryFilePaths, ...alternativeFilePaths];
    if (filePaths.length === 0) {
      return;
    }
    const names = filePaths.map((filePath) =>
      stripControlCharacters(relative(this.outputRoot, filePath)),
    );
    const one = names.length === 1;
    const deleteHint =
      primaryFilePaths.length > 0
        ? " Enable `delete` to have Rulesync remove a project-root CLAUDE.md or CLAUDE.local.md itself."
        : "";
    this.logger.warn(
      `${names.join(", ")} still ${one ? "keeps" : "keep"} Claude Code from reading AGENTS.md although \`includeRoot: false\` is set for claudecode. Rulesync leaves ${one ? "it" : "them"} in place; remove ${one ? "it" : "them"} by hand once the content is covered by AGENTS.md.${deleteHint}`,
    );
  }

  private isClaudecodeTarget(): boolean {
    return this.toolTarget === "claudecode" || this.toolTarget === "claudecode-legacy";
  }

  /**
   * The language block for targets whose adapters never mark a ToolRule as
   * root: Cursor emits every rule as `.cursor/rules/*.mdc`, and the fixed-name
   * targets (Cline, Roo, Kiro, ...) file the `root: true` source beside the
   * others. The file produced from the `root: true` source is still the root
   * rule from the user's point of view, so it is the one that gets the block.
   * Nested rules never do. When several sources are marked `root: true`, only
   * the file built from the first one (in conversion order, which follows the
   * source order) carries the block: one instruction per target is the
   * contract, and a root-marking target gets exactly one as well.
   */
  private appendLanguageBlockToRootSourceRules({
    convertedRules,
  }: {
    convertedRules: RuleConversion[];
  }): void {
    const language = this.getPromptBlockLanguage();
    if (language === undefined) {
      return;
    }
    const firstRootSource = convertedRules.find(
      ({ rulesyncRule }) => rulesyncRule.getFrontmatter().root === true,
    );
    if (firstRootSource === undefined) {
      return;
    }
    const { toolRule } = firstRootSource;
    toolRule.setFileContent(appendLanguageBlock({ content: toolRule.getFileContent(), language }));
  }

  /**
   * Claude Code's native delivery of `language`: a patch to the settings file
   * instead of a prompt block. Empty for every other target and when
   * `language` is unset, so an unset key never touches the settings file.
   */
  private async buildLanguageSettingsFiles(): Promise<ToolFile[]> {
    if (this.language === undefined || !this.isClaudecodeTarget()) {
      return [];
    }
    return [
      await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: this.outputRoot,
        language: this.language,
        global: this.global,
      }),
    ];
  }

  private buildSkillList(skillClass: {
    isTargetedByRulesyncSkill: (rulesyncSkill: RulesyncSkill) => boolean;
    getSettablePaths: (options?: { global?: boolean }) => {
      relativeDirPath: string;
    };
  }): Array<{
    name: string;
    description: string;
    path: string;
  }> {
    if (!this.skills) return [];

    const toolRelativeDirPath = skillClass.getSettablePaths({
      global: this.global,
    }).relativeDirPath;
    return this.skills
      .filter((skill) => skillClass.isTargetedByRulesyncSkill(skill))
      .map((skill) => {
        const frontmatter = skill.getFrontmatter();
        // Use tool-specific relative path, not rulesync's path
        const relativePath = join(toolRelativeDirPath, skill.getDirName(), SKILL_FILE_NAME);
        return {
          name: frontmatter.name,
          description: frontmatter.description,
          path: relativePath,
        };
      });
  }

  /**
   * Reconcile rules that resolve to the same output path.
   *
   * Multiple root fragments are composed for tools that emit a fixed root file.
   * The `fold` policy is for tools whose rules engine reads only one root file and
   * neither scans a modular rules directory nor follows references. For example,
   * dcode reads `.deepagents/AGENTS.md`, while Warp reads root or subdirectory
   * `AGENTS.md` files but never `.warp/memories/`. Those adapters must fold every
   * body into one instance because last-writer-wins would silently drop content.
   * Plain-Markdown adapters can opt into `compose` for colliding modular outputs.
   *
   * A generated root rule becomes the merge target when present. A `fold` group
   * without one uses its first rule. A group only composes when every rendered
   * fragment is plain Markdown — a fragment carrying its own frontmatter block
   * (e.g. Amp's `globs:` gate) would end up mid-body where the tool ignores it.
   * Root-involved collisions that cannot be composed safely fail; other
   * collisions remain separate and are reported by the final output-path check.
   * Mutates `convertedRules` in place.
   */
  private mergeRulesByOutputPath({
    convertedRules,
    collisionPolicy,
  }: {
    convertedRules: RuleConversion[];
    collisionPolicy: RuleCollisionPolicy;
  }): void {
    if (convertedRules.length <= 1) {
      return;
    }

    // Group rules by their output path and fold each group independently. Today
    // most folding tools emit a single path (all rules share `AGENTS.md`), but
    // Pi additionally routes `pi.systemPrompt: append` rules to a separate
    // `APPEND_SYSTEM.md`, so those must concatenate among themselves rather than
    // into the root file. Insertion order is preserved so source order is kept.
    const groups = new Map<string, RuleConversion[]>();
    for (const conversion of convertedRules) {
      const path = join(
        conversion.toolRule.getRelativeDirPath(),
        conversion.toolRule.getRelativeFilePath(),
      );
      const group = groups.get(path);
      if (group) {
        group.push(conversion);
      } else {
        groups.set(path, [conversion]);
      }
    }

    const survivors = new Set<RuleConversion>();
    for (const [path, group] of groups) {
      if (group.length === 1) {
        const conversion = group[0];
        if (conversion) {
          if (collisionPolicy === "fold") {
            conversion.toolRule.setFileContent(conversion.toolRule.getFileContent().trim());
          }
          survivors.add(conversion);
        }
        continue;
      }

      const rootConversion = group.find(({ toolRule }) => toolRule.isRoot());
      const hasSourceRoot = group.some(
        ({ rulesyncRule }) => rulesyncRule.getFrontmatter().root === true,
      );
      const { shouldCompose, sharedRootFrontmatter } = decideRuleComposition({
        group,
        collisionPolicy,
      });

      if (!shouldCompose && hasSourceRoot) {
        throw new Error(
          `Multiple generated rules resolve to output path '${path}' for target '${this.toolTarget}', but this target cannot safely compose a collision involving a root rule. Source rules: ${formatRulePaths(group.map(({ rulesyncRule }) => rulesyncRule))}`,
        );
      }

      if (!shouldCompose) {
        for (const conversion of group) {
          survivors.add(conversion);
        }
        continue;
      }

      const target = rootConversion ?? group[0];
      if (!target) {
        continue;
      }
      const ordered = [target, ...group.filter((rule) => rule !== target)];
      target.toolRule.setFileContent(
        composeRuleFragments({
          contents: ordered.map(({ toolRule }) => toolRule.getFileContent()),
          sharedFrontmatter: sharedRootFrontmatter,
        }),
      );
      survivors.add(target);
    }

    // Keep only each group's merge target; the others are now folded in.
    for (let i = convertedRules.length - 1; i >= 0; i--) {
      const conversion = convertedRules[i];
      if (conversion && !survivors.has(conversion)) {
        convertedRules.splice(i, 1);
      }
    }
  }

  private warnForOutputPathCollisions({
    outputFiles,
    convertedRules,
  }: {
    outputFiles: ToolFile[];
    convertedRules: RuleConversion[];
  }): void {
    const seen = new Map<string, ToolFile>();
    const describeSource = (file: ToolFile): string => {
      const source = convertedRules.find(({ toolRule }) => toolRule === file)?.rulesyncRule;
      return source
        ? formatRulePaths([source])
        : join(file.getRelativeDirPath(), file.getRelativeFilePath());
    };

    for (const file of outputFiles) {
      const path = join(file.getRelativeDirPath(), file.getRelativeFilePath());
      const key = path.toLowerCase();
      const previous = seen.get(key);
      if (previous) {
        const previousPath = join(previous.getRelativeDirPath(), previous.getRelativeFilePath());
        const pathDescription =
          previousPath === path
            ? `'${path}'`
            : `'${previousPath}' and '${path}' (compared case-insensitively, as on macOS and Windows)`;
        this.logger.warn(
          `Both ${describeSource(previous)} and ${describeSource(file)} generate to ${pathDescription}; the last one wins wherever they collide.`,
        );
      }
      seen.set(key, file);
    }
  }

  /**
   * Warn when this generate run is about to write a root rule file that will
   * make the tool stop reading paths it currently reads instead — Junie's
   * `.junie/rules/*.md` and `.junie/playbook.md` become unreachable the
   * moment `.junie/AGENTS.md` exists, since Junie reads the root file
   * exclusively once it is present. `importOnlyRoots` with
   * `onlyWhenRootAbsent` already models exactly this shape for import; this
   * reuses the same declaration so the
   * `generate` path — which never calls `loadToolFiles` and so never reached
   * the existing import-side warning — surfaces it too. Without this, a repo
   * that only ever runs `generate` never sees any warning: the deactivated
   * files stay on disk, untouched and not gitignored, silently unread.
   */
  private async warnForDeactivatedImportOnlyRoots({
    toolRules,
    factory,
  }: {
    toolRules: ToolRule[];
    factory: ToolRuleFactory;
  }): Promise<void> {
    const rootRule = toolRules.find((rule) => rule.isRoot());
    if (!rootRule) {
      return;
    }

    const settablePaths = factory.class.getSettablePaths({ global: this.global });
    const importOnlyRoots =
      "importOnlyRoots" in settablePaths ? settablePaths.importOnlyRoots : undefined;
    if (!importOnlyRoots || importOnlyRoots.length === 0) {
      return;
    }

    const existingPaths: string[] = [];
    for (const importOnlyRoot of importOnlyRoots) {
      // A root the tool prefers over its own root file keeps being read.
      if (importOnlyRoot.onlyWhenRootAbsent !== true || importOnlyRoot.outranksRoot === true) {
        continue;
      }
      const matchedPaths = await findFilesByGlobs(
        rootRelativeGlob(
          importOnlyRoot.relativeDirPath,
          importOnlyRoot.relativeFilePath ?? `*.${factory.meta.extension}`,
        ),
        { cwd: this.outputRoot, type: "file" },
      );
      existingPaths.push(...matchedPaths);
    }

    if (existingPaths.length === 0) {
      return;
    }

    const rootFileRelativePath = join(
      rootRule.getRelativeDirPath(),
      rootRule.getRelativeFilePath(),
    );
    const names = existingPaths.map((filePath) =>
      stripControlCharacters(relative(this.outputRoot, filePath)),
    );
    const listedNames = names.slice(0, MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS);
    const remainingCount = names.length - listedNames.length;
    this.logger.warn(
      `Writing ${stripControlCharacters(rootFileRelativePath)} for ${this.toolTarget} means ${listedNames.join(", ")}${remainingCount > 0 ? ` and ${remainingCount} more` : ""} will no longer be read. Run \`rulesync import --targets ${this.toolTarget}\` first to carry that content into ${RULESYNC_RULES_RELATIVE_DIR_PATH}, or delete ${listedNames.length === 1 ? "it" : "them"} once you have checked the content is already in the root file.`,
    );
  }

  /**
   * Warp still reads a legacy `WARP.md`, and when both `WARP.md` and
   * `AGENTS.md` sit in the same directory, `WARP.md` takes priority — so an
   * `AGENTS.md` this run writes next to one would never be read. That holds for
   * the root file and for every nested `<subprojectPath>/AGENTS.md` alike.
   * Rulesync neither writes nor deletes `WARP.md` (it is hand-authored), so the
   * only thing it can do is say so. Project scope only: the documented
   * precedence is about project rules, and Warp's global rule source is
   * `~/.agents/AGENTS.md`.
   * @see https://docs.warp.dev/agents/capabilities/rules/
   */
  private async warnForWarpLegacyRootFile(toolRules: ToolRule[]): Promise<void> {
    if (this.toolTarget !== "warp" || this.global) {
      return;
    }
    const rulePathsByDir = new Map(
      toolRules.map((rule) => [
        rule.getRelativeDirPath(),
        join(rule.getRelativeDirPath(), rule.getRelativeFilePath()),
      ]),
    );
    for (const [ruleDirPath, rulesRelativePath] of rulePathsByDir) {
      const legacyRelativePath = join(ruleDirPath, WARP_LEGACY_RULE_FILE_NAME);
      if (!(await fileExists(join(this.outputRoot, legacyRelativePath)))) {
        continue;
      }
      this.logger.warn(
        `${stripControlCharacters(legacyRelativePath)} exists next to ${stripControlCharacters(rulesRelativePath)}, and Warp reads WARP.md instead of AGENTS.md when both are present, so the generated ${stripControlCharacters(rulesRelativePath)} is ignored by Warp. Move any content you still need into ${RULESYNC_RULES_RELATIVE_DIR_PATH}, then delete or rename ${stripControlCharacters(legacyRelativePath)}.`,
      );
    }
  }

  /**
   * Handle localRoot rule generation based on tool target.
   * - `separate-local-file`: writes a dedicated `*.local.md` root file
   *   (claudecode/legacy: `./CLAUDE.local.md`, rovodev/dsh: `./AGENTS.local.md`)
   * - `append-to-root` (default): appends the body to the root file
   */
  private handleLocalRootRule(
    toolRules: ToolRule[],
    localRootRule: RulesyncRule,
    factory: ToolRuleFactory,
  ): void {
    const localRootBody = localRootRule.getBody();
    const { meta } = factory;

    if (meta.localRootMode === "separate-local-file" && meta.localRootFileName) {
      const localRule = this.buildLocalRootFile({
        factory,
        fileName: meta.localRootFileName,
        body: localRootBody,
      });
      if (localRule) {
        toolRules.push(localRule);
      }
      return;
    }

    const rootRule = toolRules.find((rule) => rule.isRoot());
    if (rootRule) {
      rootRule.setFileContent(rootRule.getFileContent() + "\n\n" + localRootBody);
    }
  }

  private buildLocalRootFile({
    factory,
    fileName,
    body,
    relativeDirPath,
    localRoot = false,
  }: {
    factory: ToolRuleFactory;
    fileName: string;
    body: string;
    /** Where the file was found on import; defaults to the generation path. */
    relativeDirPath?: string;
    /** True when importing an existing local file back to a rulesync rule. */
    localRoot?: boolean;
  }): ToolRule | null {
    return (
      factory.class.buildLocalRootFile?.({
        outputRoot: this.outputRoot,
        global: this.global,
        fileName,
        body,
        relativeDirPath,
        localRoot,
      }) ?? null
    );
  }

  /**
   * Generate reference section based on meta configuration.
   */
  private generateReferenceSectionFromMeta(
    meta: ToolRuleFactory["meta"],
    toolRules: ToolRule[],
  ): string {
    const mode = resolveRuleDiscoveryMode({
      defaultMode:
        this.global && meta.ruleDiscoveryModeGlobal
          ? meta.ruleDiscoveryModeGlobal
          : meta.ruleDiscoveryMode,
      options: this.featureOptions,
    });
    switch (mode) {
      case "toon":
        return this.generateToonReferencesSection(toolRules);
      case "claudecode-legacy":
        return this.generateReferencesSection(toolRules);
      case "auto":
      default:
        return "";
    }
  }

  /**
   * Build the additional-conventions section by collecting per-feature sections
   * contributed by each feature processor. The rules feature only decides which
   * features contribute (based on meta + simulate flags) and concatenates them;
   * the section wording lives in each feature's `getSimulatedConventionSection`.
   */
  private generateAdditionalConventionsSectionFromMeta(meta: ToolRuleFactory["meta"]): string {
    const { additionalConventions } = meta;
    if (!additionalConventions) {
      return "";
    }

    const overview = `# Additional Conventions Beyond the Built-in Functions

As this project's AI coding tool, you must follow the additional conventions below, in addition to the built-in functions.`;

    const sections: string[] = [overview];

    if (
      additionalConventions.commands &&
      this.simulateCommands &&
      CommandsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
    ) {
      sections.push(CommandsProcessor.getSimulatedConventionSection());
    }

    if (
      additionalConventions.subagents &&
      this.simulateSubagents &&
      SubagentsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
    ) {
      sections.push(SubagentsProcessor.getSimulatedConventionSection());
    }

    const skillsConfig = additionalConventions.skills;
    if (
      skillsConfig &&
      this.simulateSkills &&
      SkillsProcessor.getToolTargetsSimulated().includes(this.toolTarget) &&
      (!skillsConfig.globalOnly || this.global)
    ) {
      sections.push(
        SkillsProcessor.getSimulatedConventionSection({
          skillList: this.buildSkillList(skillsConfig.skillClass),
        }),
      );
    }

    return sections.join("\n\n") + "\n\n";
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolRules = toolFiles.filter((file): file is ToolRule => file instanceof ToolRule);

    const rulesyncRules = toolRules.map((toolRule) => {
      // A tool's separate personal local-root file maps back to a canonical
      // `localRoot: true` rule instead of the tool class's regular mapping,
      // scoped to this tool so the personal content does not spread to other
      // tools' (possibly committed) root files on the next generate.
      if (toolRule.isLocalRoot()) {
        return toolRule.toLocalRootRulesyncRule({ targets: [this.toolTarget] });
      }
      return this.withoutLanguageBlock({ toolRule, rulesyncRule: toolRule.toRulesyncRule() });
    });

    // Several tool files can derive the same rulesync file name — most easily
    // with the AGENTS.md standard's nested files, where every source is named
    // `AGENTS.md` and the rulesync name comes from the directory. The writer
    // overwrites, so without this the earlier rule disappears silently.
    // Keyed case-insensitively, because on a case-insensitive filesystem
    // `Docs.md` and `docs.md` are one file.
    const claimedBy = new Map<string, string>();
    for (const [index, rulesyncRule] of rulesyncRules.entries()) {
      const target = rulesyncRule.getRelativeFilePath();
      const source = join(
        toolRules[index]!.getRelativeDirPath(),
        toolRules[index]!.getRelativeFilePath(),
      );
      const previous = claimedBy.get(target.toLowerCase());
      if (previous === undefined) {
        claimedBy.set(target.toLowerCase(), source);
        continue;
      }
      // All three names come off the filesystem — a non-root rule's rulesync
      // name is the tool file's basename — so each is stripped before reaching
      // a terminal that would act on an embedded escape.
      this.logger.warn(
        `Both ${stripControlCharacters(previous)} and ${stripControlCharacters(source)} import to ${stripControlCharacters(join(RULESYNC_RULES_RELATIVE_DIR_PATH, target))} (compared case-insensitively, as on macOS and Windows); the last one wins wherever they collide.`,
      );
    }

    return rulesyncRules;
  }

  /**
   * Drop the language block a previous `generate` appended, so that importing
   * a generated root file and generating again yields one block, not two.
   * Every imported rule is checked, not just root ones: Cursor and the
   * fixed-name targets import their root file as a non-root rule. The
   * `language` key itself lives in `rulesync.jsonc`, so nothing about the
   * detected language is carried into the rulesync rule — which is why the
   * strip is reported: a user who imports a file carrying the block and has
   * not set `language` would otherwise lose the instruction without a trace.
   * Once per file per run, since an import over several targets reads the
   * same root file for each of them.
   */
  private withoutLanguageBlock({
    toolRule,
    rulesyncRule,
  }: {
    toolRule: ToolRule;
    rulesyncRule: RulesyncRule;
  }): RulesyncRule {
    const body = rulesyncRule.getBody();
    const stripped = stripLanguageBlock(body);
    if (stripped === body) {
      return rulesyncRule;
    }
    // The path comes off the filesystem, so it is stripped before reaching a
    // terminal that would act on an embedded escape.
    const source = stripControlCharacters(
      join(toolRule.getRelativeDirPath(), toolRule.getRelativeFilePath()),
    );
    warnOnceWithFallback(
      this.logger,
      `Removed the answer-language block rulesync appends from ${source} on import; it is not kept in .rulesync/rules/. Set "language" in rulesync.jsonc to keep generating it.`,
    );
    return new RulesyncRule({
      outputRoot: rulesyncRule.getOutputRoot(),
      relativeDirPath: rulesyncRule.getRelativeDirPath(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: rulesyncRule.getFrontmatter(),
      body: stripped,
      validate: false,
    });
  }

  /**
   * Load rulesync rule files from a single source-tree's `rules/` (and
   * `rules/.curated/`) subtree. `sourceTree` is the source tree itself
   * (e.g. `/repo/.rulesync` or `/repo/.rulesync.local`), NOT its parent.
   *
   * Intra-tree behavior — the local-wins-over-curated rule and the
   * case-insensitive collision handling — is preserved from the previous
   * single-root implementation. See `loadRulesyncFiles` for how the
   * per-root results are combined into the effective set.
   */
  private async loadRulesyncFilesForRoot(sourceTree: string): Promise<RulesyncRule[]> {
    // Anchor `RulesyncRule` instances at the parent of the source tree so
    // that `getRelativePathFromCwd()` still renders paths like
    // `.rulesync/rules/foo.md` (or `.rulesync.local/rules/foo.md` for an
    // overlay tree) — matching the previous behavior exactly.
    const treeParent = dirname(sourceTree);
    const treeName = basename(sourceTree);
    const treeRulesDirPath = join(treeName, RULES_FEATURE_SUBDIR);
    const rulesyncOutputRoot = join(sourceTree, RULES_FEATURE_SUBDIR);
    const curatedOutputRoot = join(sourceTree, CURATED_RULES_FEATURE_SUBDIR);

    // Strict: a source directory symlinked at a tree that no longer resolves
    // would otherwise glob to nothing, which reads as "every rule was deleted"
    // — `--delete` then removes what it could not regenerate and the run still
    // reports success.
    const [rulesDirExists, curatedDirExists] = await Promise.all([
      directoryExistsStrict(rulesyncOutputRoot),
      directoryExistsStrict(curatedOutputRoot),
    ]);

    const [discoveredFiles, discoveredCuratedFiles] = await Promise.all([
      rulesDirExists ? findFilesByGlobs("**/*.md", { cwd: rulesyncOutputRoot }) : [],
      curatedDirExists ? findFilesByGlobs("**/*.md", { cwd: curatedOutputRoot }) : [],
    ]);

    const files = [...new Set([...discoveredFiles, ...discoveredCuratedFiles])];

    const localFiles = files.filter(
      (file) => !relative(rulesyncOutputRoot, file).startsWith(`.curated${sep}`),
    );
    // Keyed by case-folded path because a curated and a local file whose names
    // differ only in case collapse onto one file on macOS/Windows, so the
    // curated one cannot be emitted alongside the local one there.
    const localRelativePathsByIdentity = groupSpellingsByCaseFoldedIdentity(
      localFiles.map((file) => relative(rulesyncOutputRoot, file)),
    );

    const curatedFiles = files
      .filter((file) => relative(rulesyncOutputRoot, file).startsWith(`.curated${sep}`))
      .map((file) => ({ file, relativeFilePath: relative(curatedOutputRoot, file) }))
      .filter(({ relativeFilePath }) => {
        const spellings = localRelativePathsByIdentity.get(caseFoldIdentity(relativeFilePath));

        if (spellings === undefined) {
          return true;
        }

        // An exact match is the documented local-wins-over-curated flow and
        // stays silent; a case-only match is ambiguous enough to surface,
        // mirroring the warning the cross-root merge emits. The exact spelling
        // is preferred so an unrelated case variant sitting next to it does
        // not turn a plain override into a spurious collision warning.
        if (!spellings.includes(relativeFilePath)) {
          this.logger.warn(
            formatCuratedCaseCollisionWarning({
              artifactKind: "rule",
              entryNoun: "file",
              treeDirPath: treeRulesDirPath,
              curatedSpelling: join(".curated", relativeFilePath),
              localSpellings: spellings,
            }),
          );
        }

        return false;
      });

    const selectedFiles = [
      ...localFiles.map((file) => ({
        file,
        sourceRelativeFilePath: relative(rulesyncOutputRoot, file),
        relativeFilePath: relative(rulesyncOutputRoot, file),
      })),
      ...curatedFiles.map(({ file, relativeFilePath }) => ({
        file,
        sourceRelativeFilePath: join(".curated", relativeFilePath),
        relativeFilePath,
      })),
    ];

    this.logger.debug(`Found ${selectedFiles.length} rulesync files under ${rulesyncOutputRoot}`);

    return await Promise.all(
      selectedFiles.map(async ({ sourceRelativeFilePath, relativeFilePath }) => {
        checkPathTraversal({
          relativePath: sourceRelativeFilePath,
          intendedRootDir: rulesyncOutputRoot,
        });

        const rule = await RulesyncRule.fromFile({
          outputRoot: treeParent,
          relativeDirPath: treeRulesDirPath,
          relativeFilePath: sourceRelativeFilePath,
          deriveSubprojectPathFromGlobs: this.deriveSubprojectPathFromGlobs,
        });

        if (sourceRelativeFilePath === relativeFilePath) {
          return rule;
        }

        return new RulesyncRule({
          outputRoot: treeParent,
          relativeDirPath: treeRulesDirPath,
          relativeFilePath,
          frontmatter: rule.getFrontmatter(),
          body: rule.getBody(),
        });
      }),
    );
  }

  /**
   * Load and merge rulesync rule files from every configured input root's
   * `.rulesync/rules/` directory, by relative path, so that a rule with the
   * same target path from a later root replaces the earlier root's copy
   * (case-insensitive, matching the intra-root collision handling).
   *
   * This is the side-effect-free half of `loadRulesyncFiles`: it does not
   * warn about a missing root rule or validate `localRoot` placement, so it
   * is also safe to call from code paths — like
   * `warnForFoldImportDuplicationRisk` — that only need the merged rule set
   * and must not trigger `loadRulesyncFiles`'s generate-time checks.
   */
  private async loadMergedRulesyncRules(): Promise<RulesyncRule[]> {
    const perRoot = await Promise.all(
      this.inputRoots.map((root) => this.loadRulesyncFilesForRoot(root)),
    );

    return mergeByCaseInsensitiveIdentity({
      perRoot,
      identity: (rule) => rule.getRelativeFilePath(),
      artifactName: "rule",
      logger: this.logger,
    });
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync rule files from every configured input root's
   * `.rulesync/rules/` directory, merging by relative path so that a rule
   * with the same target path from a later root replaces the earlier root's
   * copy (case-insensitive, matching the intra-root collision handling).
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const rulesyncRules = await this.loadMergedRulesyncRules();

    const factory = this.getFactory(this.toolTarget);

    const rootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().root);

    // Filter roots to those targeting this tool
    const targetedRootRules = rootRules.filter((rule) =>
      factory.class.isTargetedByRulesyncRule(rule),
    );

    if (targetedRootRules.length === 0 && rulesyncRules.length > 0) {
      this.logger.warn(
        `No root rulesync rule file found for target '${this.toolTarget}'. Consider adding 'root: true' to one of your rule files in ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
      );
    }

    // Validation for localRoot — scoped to this tool's target
    const localRootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().localRoot);
    const targetedLocalRootRules = localRootRules.filter((rule) =>
      factory.class.isTargetedByRulesyncRule(rule),
    );

    if (targetedLocalRootRules.length > 1) {
      throw new Error(
        `Multiple localRoot rules found for target '${this.toolTarget}': ${formatRulePaths(targetedLocalRootRules)}. Only one rule can have localRoot: true`,
      );
    }

    if (targetedLocalRootRules.length > 0 && targetedRootRules.length === 0) {
      throw new Error(
        `localRoot: true requires a root: true rule to exist for target '${this.toolTarget}' (found in ${formatRulePaths(targetedLocalRootRules)})`,
      );
    }

    // In global mode, retain non-root rules when the target can emit or fold them globally
    if (this.global) {
      const globalPaths = factory.class.getSettablePaths({ global: true });
      const supportsGlobalNonRoot =
        ("nonRoot" in globalPaths && globalPaths.nonRoot !== null) ||
        (factory.meta.supportsGlobal && factory.meta.collisionPolicy === "fold");

      const nonRootRules = rulesyncRules.filter(
        (rule) =>
          !rule.getFrontmatter().root &&
          !rule.getFrontmatter().localRoot &&
          factory.class.isTargetedByRulesyncRule(rule),
      );

      const globalRoutedRules = supportsGlobalNonRoot
        ? []
        : nonRootRules.filter((rule) => factory.class.isEmittedAsGlobalNonRootRule?.(rule));
      const ignoredNonRootRules = supportsGlobalNonRoot
        ? []
        : nonRootRules.filter((rule) => !globalRoutedRules.includes(rule));
      if (ignoredNonRootRules.length > 0) {
        this.logger.warn(
          `${ignoredNonRootRules.length} non-root rulesync rules found, but it's in global mode, so ignoring them: ${formatRulePaths(ignoredNonRootRules)}`,
        );
      }
      if (targetedLocalRootRules.length > 0) {
        this.logger.warn(
          `${targetedLocalRootRules.length} localRoot rules found, but localRoot is not supported in global mode, ignoring them: ${formatRulePaths(targetedLocalRootRules)}`,
        );
      }
      return supportsGlobalNonRoot
        ? [...targetedRootRules, ...nonRootRules]
        : [...targetedRootRules, ...globalRoutedRules];
    }

    // In project mode, exclude root rules not targeting this tool and filter non-root by target
    const nonRootRules = rulesyncRules.filter(
      (rule) => !rule.getFrontmatter().root && factory.class.isTargetedByRulesyncRule(rule),
    );
    return [...targetedRootRules, ...nonRootRules];
  }

  /**
   * Pi reads `AGENTS.override.md` *instead of* `AGENTS.md` from a directory, and
   * non-root Pi rules are folded into whichever file the root emits. A mix of
   * opted-in and opted-out rules would therefore split the output across both
   * files and let Pi silently ignore everything in `AGENTS.md`, so the root rule
   * decides for all of them: its `pi.contextFile` is copied onto the non-root
   * rules, and the flag set only on a non-root rule is dropped with a warning.
   */
  private alignPiContextFile(
    rules: RulesyncRule[],
    { warn = true }: { warn?: boolean } = {},
  ): RulesyncRule[] {
    if (this.toolTarget !== "pi") return rules;

    const factory = this.getFactory(this.toolTarget);
    const targeted = rules.filter((rule) => factory.class.isTargetedByRulesyncRule(rule));
    // Any root rule opting in decides for the whole output: with several root
    // rules, honoring only one of them would leave the others in the file Pi
    // stops reading.
    const rootContextFile = targeted.some(
      (rule) =>
        rule.getFrontmatter().root === true && rule.getFrontmatter().pi?.contextFile === "override",
    )
      ? ("override" as const)
      : undefined;
    const mismatched = targeted.filter(
      (rule) => rule.getFrontmatter().pi?.contextFile !== rootContextFile,
    );
    if (mismatched.length === 0) return rules;

    if (warn && rootContextFile === undefined) {
      this.logger.warn(
        `pi.contextFile is set on ${mismatched.length} non-root rule(s) but not on the root rule, ` +
          `so it is ignored: Pi folds every rule body into the root context file, and emitting ` +
          `AGENTS.override.md for some of them would hide the rest. Set it on the root rule ` +
          `instead: ${formatRulePaths(mismatched)}`,
      );
    }

    const mismatchedSet = new Set(mismatched);
    return rules.map((rule) => {
      if (!mismatchedSet.has(rule)) return rule;
      const frontmatter = rule.getFrontmatter();
      const { contextFile: _dropped, ...pi } = frontmatter.pi ?? {};
      const nextPi = { ...pi, ...(rootContextFile ? { contextFile: rootContextFile } : {}) };
      return new RulesyncRule({
        outputRoot: rule.getOutputRoot(),
        relativeDirPath: rule.getRelativeDirPath(),
        relativeFilePath: rule.getRelativeFilePath(),
        frontmatter: {
          ...frontmatter,
          ...(Object.keys(nextPi).length > 0 ? { pi: nextPi } : { pi: undefined }),
        },
        body: rule.getBody(),
        // The source rule was already parsed under its own validate setting;
        // only the pi block changes here.
        validate: false,
      });
    });
  }

  /**
   * Warn when importing a `collisionPolicy: "fold"` target's root file while
   * `.rulesync/rules/` still holds non-root rules targeting it. A fold target
   * (codexcli, junie, and others) concatenates every targeted non-root rule
   * into its one root output file on `generate`. Importing that root file
   * back therefore re-reads the already-folded content as a single new
   * rulesync rule, while the original non-root rules stay in place
   * untouched — the next `generate` folds both together, duplicating the
   * content once per generate/import cycle with nothing to indicate why.
   *
   * This does not attempt to detect or drop the specific duplicated content
   * (the root file has no marker recording which rule contributed what); it
   * only surfaces that the cycle produces one, per the "at minimum, warn"
   * option recorded on issue #2743.
   *
   * Only the actual `rulesync import` call site invokes this (and only once
   * it has confirmed there is something to import) — `loadToolFiles` is also
   * the entry point for `rulesync convert` and `rulesync fetch`, neither of
   * which writes to `.rulesync/rules/` or carries this duplication risk.
   *
   * Reads via `loadMergedRulesyncRules` rather than `loadRulesyncFiles`
   * deliberately: this runs before the imported root file is written, so
   * `.rulesync/rules/` never yet has a root rule targeting this tool, and
   * `loadRulesyncFiles`'s "no root rule found" warning and `localRoot`
   * validation (which can throw) would fire spuriously on every fold-tool
   * import — including ones where nothing is actually misconfigured.
   *
   * In global mode, a `localRoot: true` rule is excluded from the
   * duplication check the same way `loadRulesyncFiles`'s global-mode branch
   * excludes it from `nonRootRules`: `generate` ignores `localRoot` entirely
   * in global mode, so such a rule is never actually folded into the global
   * root output and warning about it here would be inaccurate. The same goes
   * for a tool that writes `localRoot` to a dedicated local file.
   *
   * Non-root rules written to a file other than the root (nested
   * per-directory files, Pi's `APPEND_SYSTEM.md`) get a separate warning when
   * that file already exists and would import under a different name.
   */
  async warnForFoldImportDuplicationRisk(): Promise<void> {
    const factory = this.getFactory(this.toolTarget);
    if (factory.meta.collisionPolicy !== "fold") {
      return;
    }

    // Resolve placement the way generate does: Pi's non-root rules follow the
    // root rule's `pi.contextFile` (aligned silently here, since the mismatch
    // warning belongs to generate).
    const mergedRules = this.alignPiContextFile(await this.loadMergedRulesyncRules(), {
      warn: false,
    });
    const targetedRules = mergedRules.filter((rule) =>
      factory.class.isTargetedByRulesyncRule(rule),
    );
    // An invalid `includeLocalRoot` is reported by generate; a warning must
    // not abort the import, so fall back to the default here.
    let includeLocalRoot = !this.global;
    try {
      includeLocalRoot &&= resolveIncludeLocalRoot(this.featureOptions);
    } catch {
      // Keep the default.
    }
    const targetedNonRootRules = targetedRules.filter(
      (rule) =>
        !rule.getFrontmatter().root &&
        // A `localRoot` rule is ignored in global mode or when local roots are
        // excluded, and a tool with a dedicated local file (e.g.
        // `CRUSH.local.md`) writes it there instead of folding it.
        !(
          rule.getFrontmatter().localRoot &&
          (!includeLocalRoot || factory.meta.localRootMode === "separate-local-file")
        ),
    );

    // Every path the root output can take: the default root file plus
    // wherever a root rule sends it (Pi's `AGENTS.override.md`, which the
    // non-root rules follow on generate).
    const rootPaths = new Set<string>();
    const { root } = factory.class.getSettablePaths({ global: this.global });
    if (root) {
      rootPaths.add(posix.join(normalizeRelativeDir(root.relativeDirPath), root.relativeFilePath));
    }
    for (const rulesyncRule of targetedRules.filter((rule) => rule.getFrontmatter().root)) {
      const toolRule = this.toToolRuleForImportCheck({ factory, rulesyncRule });
      rootPaths.add(toolOutputPath(toolRule));
    }

    // Only rules that land in the root file are folded. Any other non-root
    // rule is written to a file of its own (a nested per-directory
    // `AGENTS.md` for codexcli, pool, vibe, dsh, warp and reasonix, or Pi's
    // `APPEND_SYSTEM.md`) that import reads back as a separate rulesync rule
    // named after that file; it duplicates the source rule only when the
    // source has another name.
    const separateRules: RuleConversion[] = [];
    const foldedRules: RulesyncRule[] = [];
    let localRootCounted = false;
    for (const rulesyncRule of targetedNonRootRules) {
      // A remaining `localRoot` rule is appended to the root file whatever its
      // own path would be. Generate rejects several `localRoot` rules, so only
      // the first is listed.
      if (rulesyncRule.getFrontmatter().localRoot) {
        if (!localRootCounted) {
          foldedRules.push(rulesyncRule);
          localRootCounted = true;
        }
        continue;
      }
      const toolRule = this.toToolRuleForImportCheck({ factory, rulesyncRule });
      if (rootPaths.size === 0 || rootPaths.has(toolOutputPath(toolRule))) {
        foldedRules.push(rulesyncRule);
      } else {
        separateRules.push({ toolRule, rulesyncRule });
      }
    }

    if (foldedRules.length > 0) {
      this.logger.warn(
        `Importing ${this.toolTarget}'s root file will re-add content already folded from ${formatRulePaths(foldedRules)}: ${this.toolTarget} concatenates every non-root rule into its single root output file, so the imported copy duplicates them the next time you run \`rulesync generate --targets ${this.toolTarget}\`. Review the imported rule and remove the duplicated content, or remove the original non-root rule files, before generating again.`,
      );
    }

    const duplicated: RuleConversion[] = [];
    for (const conversion of separateRules) {
      const { toolRule, rulesyncRule } = conversion;
      const importedName = toolRule.toRulesyncRule().getRelativeFilePath();
      if (importedName.toLowerCase() === rulesyncRule.getRelativeFilePath().toLowerCase()) {
        continue;
      }
      if (await fileExists(toolRule.getFilePath())) {
        duplicated.push(conversion);
      }
    }
    if (duplicated.length > 0) {
      const fileNames = [
        ...new Set(duplicated.map(({ toolRule }) => toolRule.getRelativeFilePath())),
      ].join(", ");
      this.logger.warn(
        `Importing ${this.toolTarget}'s ${fileNames} files outside the root file will re-add content already written from ${formatRulePaths(duplicated.map(({ rulesyncRule }) => rulesyncRule))}: each such file is imported as its own rule under a name derived from its path, so the imported copy and the original rule resolve to the same file and are concatenated the next time you run \`rulesync generate --targets ${this.toolTarget}\`. Remove one of the two copies before generating again.`,
      );
    }
  }

  private toToolRuleForImportCheck({
    factory,
    rulesyncRule,
  }: {
    factory: ToolRuleFactory;
    rulesyncRule: RulesyncRule;
  }): ToolRule {
    return factory.class.fromRulesyncRule({
      outputRoot: this.outputRoot,
      rulesyncRule,
      validate: false,
      global: this.global,
    });
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = this.getFactory(this.toolTarget);
      const settablePaths = factory.class.getSettablePaths({
        global: this.global,
      });

      const resolveRelativeDirPath = (filePath: string): string => {
        const dirName = dirname(relative(this.outputRoot, filePath));
        return dirName === "" ? "." : dirName;
      };

      /**
       * Build deletion rules from discovered file paths: resolve dir, check traversal, create forDeletion, filter isDeletable.
       *
       * Two modes:
       * - Root mode (no opts): `relativeFilePath` = `basename(filePath)`, traversal checks `relativeDirPath` against `this.outputRoot`.
       * - Non-root mode (with `outputRootOverride` + `relativeDirPathOverride`): `relativeFilePath` = `relative(outputRootOverride, filePath)`,
       *   traversal checks `relativeFilePath` against `outputRootOverride`.
       */
      const buildDeletionRulesFromPaths = (
        filePaths: string[],
        opts?: { outputRootOverride: string; relativeDirPathOverride: string },
      ): ToolRule[] => {
        const isNonRoot = opts !== undefined;
        const effectiveOutputRoot = isNonRoot ? opts.outputRootOverride : this.outputRoot;
        return filePaths
          .map((filePath) => {
            const relativeDirPath = isNonRoot
              ? opts.relativeDirPathOverride
              : resolveRelativeDirPath(filePath);
            const relativeFilePath = isNonRoot
              ? relative(effectiveOutputRoot, filePath)
              : basename(filePath);
            checkPathTraversal({
              relativePath: isNonRoot ? relativeFilePath : relativeDirPath,
              intendedRootDir: effectiveOutputRoot,
            });
            return factory.class.forDeletion({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath,
              global: this.global,
            });
          })
          .filter((rule) => rule.isDeletable());
      };

      /**
       * Import counterpart of {@link buildDeletionRulesFromPaths} for the
       * root-shaped scans (root, legacy roots, and read-only roots), whose
       * paths all sit at a directory Rulesync resolves from the file itself.
       */
      const buildImportRulesFromPaths = (filePaths: string[]): Promise<ToolRule[]> =>
        Promise.all(
          filePaths.map((filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath: basename(filePath),
              global: this.global,
            });
          }),
        );

      /**
       * The tool's own root file, as opposed to whichever root
       * `rootToolRules` ends up resolving. A legacy root reached through
       * `alternativeRoots` is deliberately not counted here: it is a
       * hand-authored file Rulesync never writes, so it has folded nothing in,
       * and in Junie's resolution order it ranks *below* the multi-file layout
       * that `importOnlyRoots` describes. Gating those roots on it would drop
       * exactly the files the tool is really reading.
       *
       * Resolved once, up front, so the two blocks that need it do not depend
       * on each other's evaluation order.
       */
      const omitsRootFiles = this.omitsRootFiles();
      const primaryRootFilePaths = settablePaths.root
        ? await findFilesByGlobs(
            rootRelativeGlob(
              settablePaths.root.relativeDirPath ?? ".",
              settablePaths.root.relativeFilePath,
            ),
            { cwd: this.outputRoot },
          )
        : [];

      const rootToolRules = await (async () => {
        if (!settablePaths.root) {
          return [];
        }

        if (forDeletion && omitsRootFiles) {
          // Only sweep the file Rulesync writes: a `.claude/CLAUDE.md` is
          // hand-authored, so it is reported instead of deleted.
          await this.warnForShadowingRootFiles({ includePrimaryRoots: false });
          return buildDeletionRulesFromPaths(primaryRootFilePaths);
        }

        const uniqueRootFilePaths = await findFilesWithFallback(
          primaryRootFilePaths,
          settablePaths.alternativeRoots,
          (alt) => rootRelativeGlob(alt.relativeDirPath, alt.relativeFilePath),
          this.outputRoot,
        );

        if (forDeletion) {
          return buildDeletionRulesFromPaths(uniqueRootFilePaths);
        }

        return await buildImportRulesFromPaths(uniqueRootFilePaths);
      })();
      this.logger.debug(`Found ${rootToolRules.length} root tool rule files`);

      // Load the separate `*.local.md` file (import and deletion) when the
      // tool uses one, so a personal local-root file round-trips back to a
      // canonical `localRoot: true` rulesync rule instead of being emit-only.
      const localRootToolRules = await (async () => {
        if (
          this.global ||
          factory.meta.localRootMode !== "separate-local-file" ||
          !factory.meta.localRootFileName
        ) {
          return [];
        }
        const fileName = factory.meta.localRootFileName;

        const filePaths = await (async () => {
          if (factory.class.getLocalRootFileGlob) {
            return await findFilesByGlobs(factory.class.getLocalRootFileGlob({ fileName }), {
              cwd: this.outputRoot,
            });
          }
          if (!settablePaths.root) {
            return [];
          }
          const primaryLocalFilePaths = await findFilesByGlobs(
            rootRelativeGlob(settablePaths.root.relativeDirPath ?? ".", fileName),
            { cwd: this.outputRoot },
          );
          if (forDeletion && omitsRootFiles) {
            return primaryLocalFilePaths;
          }
          return await findFilesWithFallback(
            primaryLocalFilePaths,
            settablePaths.alternativeRoots,
            (alt) => rootRelativeGlob(alt.relativeDirPath, fileName),
            this.outputRoot,
          );
        })();

        if (forDeletion) {
          return buildDeletionRulesFromPaths(filePaths);
        }

        const importedRules = await Promise.all(
          filePaths.map(async (filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            const body = await readFileContent(filePath);
            return this.buildLocalRootFile({
              factory,
              fileName: basename(filePath),
              body,
              relativeDirPath,
              localRoot: true,
            });
          }),
        );
        return importedRules.filter((rule): rule is ToolRule => rule !== null);
      })();
      this.logger.debug(`Found ${localRootToolRules.length} local root tool rule files`);

      const rootMirrorDeletionRules = await (async () => {
        const rootMirror = factory.class.getRootMirror?.();
        if (!forDeletion || this.global || !rootMirror) {
          return [];
        }
        const { primaryGlob, mirrorGlob } = rootMirror.getMirrorDeletionGlobs();
        const primaryPaths = await findFilesByGlobs(primaryGlob, { cwd: this.outputRoot });
        if (primaryPaths.length === 0) {
          return [];
        }
        const mirrorPaths = await findFilesByGlobs(mirrorGlob, { cwd: this.outputRoot });
        return buildDeletionRulesFromPaths(mirrorPaths);
      })();

      // Extra fixed-path files (e.g. Pi's APPEND_SYSTEM.md) enumerated for both
      // import and deletion so they round-trip and stale files are cleaned up —
      // except `importOnly` entries, which are enumerated on import only.
      const extraFixedToolRules = await (async () => {
        const extraFiles = factory.class
          .getExtraFixedFiles?.({ global: this.global })
          .filter((file) => !(forDeletion && file.importOnly));
        if (!extraFiles || extraFiles.length === 0) {
          return [];
        }

        // Files only: a glob entry such as `*.md` would otherwise match a
        // directory named `x.md`, which cannot be read as a rule.
        const findExtraFiles = async (files: ToolRuleExtraFixedFile[]) =>
          files.length === 0
            ? []
            : await findFilesByGlobs(
                files.map((file) => rootRelativeGlob(file.relativeDirPath, file.relativeFilePath)),
                { cwd: this.outputRoot, type: "file" },
              );
        const managedFilePaths = await findExtraFiles(
          extraFiles.filter((file) => !file.importOnly),
        );
        if (forDeletion) {
          return managedFilePaths.length === 0 ? [] : buildDeletionRulesFromPaths(managedFilePaths);
        }

        // An `importOnly` directory is shared with hand-written files, so a
        // symlink there (the file or a directory above it) may point anywhere;
        // skip it rather than copy its target into `.rulesync/rules/`, where
        // it may be committed. A link is detected as a file whose real path,
        // taken against the real output root, differs from its spelled one.
        const importOnlyFilePaths: string[] = [];
        for (const filePath of await findExtraFiles(extraFiles.filter((file) => file.importOnly))) {
          const spelledPath = toPosixPath(relative(this.outputRoot, filePath));
          const realPath = await resolvedRelativePath({
            rootPath: this.outputRoot,
            targetPath: filePath,
          });
          if (realPath !== spelledPath) {
            this.logger.warn(
              `Skipping symbolic link ${stripControlCharacters(spelledPath)} on import: ${this.toolTarget} files reached through a link are not copied into ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
            );
            continue;
          }
          importOnlyFilePaths.push(filePath);
        }
        const filePaths = [...managedFilePaths, ...importOnlyFilePaths];
        if (filePaths.length === 0) {
          return [];
        }

        return await Promise.all(
          filePaths.map((filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath: basename(filePath),
              global: this.global,
            });
          }),
        );
      })();
      this.logger.debug(`Found ${extraFixedToolRules.length} extra fixed tool rule files`);

      // Pattern-discovered rule files (the AGENTS.md standard's nested
      // subproject files). Import only — see `getNestedFileGlobs`.
      const nestedToolRules = await (async () => {
        // Never in global mode: the output root is the home directory there, and
        // walking all of it looking for subprojects is both wrong and expensive.
        const patterns = this.global ? undefined : factory.class.getNestedFilePatterns?.();
        if (forDeletion || !patterns || patterns.include.length === 0) {
          return [];
        }

        // Symlinks are not followed. Unlike the fixed-path scans, this one walks
        // the whole project tree, so a symlink committed to a repository could
        // otherwise pull a file from outside the project (a key, a dotfile) into
        // version-controlled `.rulesync/rules/`. Not following them also keeps a
        // pair of directory symlinks from exploding the traversal.
        const matchedPaths = await findFilesByGlobs(patterns.include, {
          cwd: this.outputRoot,
          type: "file",
          followSymbolicLinks: false,
          ignore: patterns.ignore,
        });

        // The project's own statement of what is not its source. Without it a
        // vendored dependency's rule file — third-party content the user
        // deliberately kept untracked — would be copied into version-controlled
        // `.rulesync/rules/`, and targets that concatenate non-root rules into
        // one file would then load it unconditionally.
        const filePaths = filterOutPathsInGitIgnoredDirectories({
          rootDir: this.outputRoot,
          filePaths: matchedPaths,
          ownedDirPath: patterns.ownedDirPath,
        });

        return await Promise.all(
          filePaths.map((filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath: basename(filePath),
              global: this.global,
            });
          }),
        );
      })();
      this.logger.debug(`Found ${nestedToolRules.length} nested tool rule files`);

      // Read-only rule roots a tool documents but Rulesync never writes to
      // (Junie's `.junie/rules/*.md` and `.junie/playbook.md`). Import only:
      // since generation never produces them, treating them as deletion
      // candidates would delete hand-authored files rulesync does not own.
      //
      // These are fixed, tool-owned directories, so this scan mirrors the
      // `nonRoot` one below rather than the nested one above: symlinks are
      // followed, because a shared rules tree linked into `.junie/rules` is a
      // supported layout (see `docs/guide/separate-input-root.md` on symlinks
      // and trust). It runs in project scope only — see `importOnlyRoots`.
      const importOnlyToolRules = await (async () => {
        // Project scope only — `ToolRuleSettablePathsGlobal` has no
        // `importOnlyRoots`, so in global mode this narrows away rather than
        // globbing relative directories under the user's home.
        const importOnlyRoots =
          "importOnlyRoots" in settablePaths ? settablePaths.importOnlyRoots : undefined;
        if (forDeletion || !importOnlyRoots || importOnlyRoots.length === 0) {
          return [];
        }

        // A root file that exists has already absorbed these rules on a previous
        // generate (Junie folds non-root rules into `.junie/AGENTS.md`), so
        // re-importing them beside it would duplicate the same content once per
        // import/generate cycle. See `onlyWhenRootAbsent`. Only the tool's own
        // root counts — see `primaryRootFilePaths`.
        const rootFilePath = primaryRootFilePaths[0];

        const scannedPaths: string[] = [];
        const skippedPaths: string[] = [];
        const skippedOutrankingPaths: string[] = [];
        for (const importOnlyRoot of importOnlyRoots) {
          const matchedPaths = await findFilesByGlobs(
            rootRelativeGlob(
              importOnlyRoot.relativeDirPath,
              importOnlyRoot.relativeFilePath ?? `*.${factory.meta.extension}`,
            ),
            { cwd: this.outputRoot, type: "file" },
          );
          if (importOnlyRoot.onlyWhenRootAbsent === true && rootFilePath !== undefined) {
            (importOnlyRoot.outranksRoot === true ? skippedOutrankingPaths : skippedPaths).push(
              ...matchedPaths,
            );
            continue;
          }
          scannedPaths.push(...matchedPaths);
        }

        // Left unreported these look imported but silently are not, and the
        // tool no longer reads them either — a state worth acting on. The
        // names come off the filesystem, so they are stripped of control
        // characters before reaching a terminal, and the list is capped so a
        // large rules directory cannot turn one warning into a wall of text.
        if (skippedPaths.length > 0 && rootFilePath !== undefined) {
          const skippedNames = skippedPaths.map((filePath) =>
            stripControlCharacters(relative(this.outputRoot, filePath)),
          );
          const listedNames = skippedNames.slice(0, MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS);
          const remainingCount = skippedNames.length - listedNames.length;
          this.logger.warn(
            `Not importing ${listedNames.join(", ")}${remainingCount > 0 ? ` and ${remainingCount} more` : ""} for ${this.toolTarget}: ${stripControlCharacters(relative(this.outputRoot, rootFilePath))} exists, and the tool reads that file exclusively. Delete them once you have checked that content is in the root file, or move it into ${RULESYNC_RULES_RELATIVE_DIR_PATH} if it is not.`,
          );
        }

        // The tool reads these instead of the root file, so the root file just
        // imported is the one it ignores.
        if (skippedOutrankingPaths.length > 0 && rootFilePath !== undefined) {
          const rootName = stripControlCharacters(relative(this.outputRoot, rootFilePath));
          const skippedNames = skippedOutrankingPaths.map((filePath) =>
            stripControlCharacters(relative(this.outputRoot, filePath)),
          );
          const listedNames = skippedNames.slice(0, MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS);
          const remainingCount = skippedNames.length - listedNames.length;
          this.logger.warn(
            `Not importing ${listedNames.join(", ")}${remainingCount > 0 ? ` and ${remainingCount} more` : ""} for ${this.toolTarget}: ${rootName} is imported instead, but ${this.toolTarget} reads ${listedNames.length === 1 ? "that file" : "those files"} in place of ${rootName} when both exist. Move any content only it has into ${RULESYNC_RULES_RELATIVE_DIR_PATH} and delete it, so the generated ${rootName} takes effect.`,
          );
        }

        return await buildImportRulesFromPaths(scannedPaths);
      })();
      this.logger.debug(`Found ${importOnlyToolRules.length} import-only tool rule files`);

      const nonRootToolRules = await (async () => {
        if (!settablePaths.nonRoot) {
          return [];
        }

        const nonRootOutputRoot = join(this.outputRoot, settablePaths.nonRoot.relativeDirPath);
        const isSharedGlobalNonRootDir =
          this.global && factory.meta.sharedGlobalNonRootDir === true;
        const nonRootFilePaths = await findFilesByGlobs(
          !forDeletion && factory.meta.nonRootImportGlob !== undefined
            ? factory.meta.nonRootImportGlob
            : `${isSharedGlobalNonRootDir ? "" : "**/"}*.${factory.meta.extension}`,
          { cwd: nonRootOutputRoot, followSymbolicLinks: !forDeletion },
        );

        if (forDeletion) {
          return buildDeletionRulesFromPaths(nonRootFilePaths, {
            outputRootOverride: nonRootOutputRoot,
            relativeDirPathOverride: settablePaths.nonRoot.relativeDirPath,
          });
        }

        const modularRootRelative = settablePaths.nonRoot.relativeDirPath;

        // When the root file lives in the same directory as the non-root files
        // (e.g. Kiro's global steering, where the root is `~/.kiro/steering/
        // product.md` alongside the non-root `~/.kiro/steering/*.md`), the
        // non-root glob also matches the root file. Exclude it here so the root
        // rule is not imported a second time as a non-root rule.
        const rootFileNameInSameDir =
          settablePaths.root?.relativeDirPath === settablePaths.nonRoot.relativeDirPath
            ? settablePaths.root?.relativeFilePath
            : undefined;

        const nonRootPathsForImport = (
          factory.class === RovodevRule
            ? nonRootFilePaths.filter((filePath) => {
                const relativeFilePath = relative(nonRootOutputRoot, filePath);
                const ok = RovodevRule.isAllowedModularRulesRelativePath(relativeFilePath);
                if (!ok) {
                  this.logger.warn(
                    `Skipping reserved Rovodev path under modular-rules (import): ${join(modularRootRelative, relativeFilePath)}`,
                  );
                }
                return ok;
              })
            : nonRootFilePaths
        ).filter(
          (filePath) =>
            rootFileNameInSameDir === undefined ||
            relative(nonRootOutputRoot, filePath) !== rootFileNameInSameDir,
        );

        const loadedNonRootRules = await Promise.all(
          nonRootPathsForImport.map(async (filePath) => {
            const relativeFilePath = relative(nonRootOutputRoot, filePath);
            checkPathTraversal({
              relativePath: relativeFilePath,
              intendedRootDir: nonRootOutputRoot,
            });
            try {
              return await factory.class.fromFile({
                outputRoot: this.outputRoot,
                relativeDirPath: modularRootRelative,
                relativeFilePath,
                global: this.global,
              });
            } catch (error) {
              // A shared directory holds files other writers own, so one of
              // them being unreadable must not abort the whole import.
              if (!isSharedGlobalNonRootDir) {
                throw error;
              }
              this.logger.warn(
                `Skipping ${stripControlCharacters(join(modularRootRelative, relativeFilePath))} for ${this.toolTarget}: ${formatError(error)}`,
              );
              return undefined;
            }
          }),
        );
        return loadedNonRootRules.filter((rule): rule is ToolRule => rule !== undefined);
      })();
      this.logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

      return [
        // Ahead of the root rules on purpose: an import that maps two tool files
        // onto one `.rulesync/rules/` name keeps the last of them, so a root
        // file outranks a read-only root that happens to hold, say, an
        // `overview.md`. `onlyWhenRootAbsent` already keeps the two apart
        // whenever the tool's own root file exists; this is what settles the
        // remaining case, a legacy root beside a read-only one. Either way the
        // loser is named in a collision warning rather than dropped silently.
        // (A statement about these two blocks only: `nonRoot` rules come last
        // and have always outranked the root file.)
        ...importOnlyToolRules,
        ...rootToolRules,
        ...localRootToolRules,
        ...rootMirrorDeletionRules,
        ...extraFixedToolRules,
        ...nestedToolRules,
        ...nonRootToolRules,
      ];
    } catch (error) {
      this.logger.error(`Failed to load tool files for ${this.toolTarget}: ${formatError(error)}`);
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return rulesProcessorToolTargetsGlobal;
    }
    return rulesProcessorToolTargets;
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid RulesProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolRuleFactory | undefined {
    // Validate that target is supported
    const result = RulesProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolRuleFactories.get(result.data);
  }

  private generateToonReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter(
      (rule) => !rule.isRoot() && !rule.isExcludedFromRootReferences(),
    );

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push(
      "Please also reference the following rules as needed. The list below is provided in TOON format, and `@` stands for the project root directory.",
    );
    lines.push("");

    const rules = toolRulesWithoutRoot.map((toolRule) => {
      const rulesyncRule = toolRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      const rule: {
        path: string;
        description?: string;
        applyTo?: string[];
      } = {
        path: `@${toolRule.getRelativePathFromCwd()}`,
      };

      if (frontmatter.description) {
        rule.description = frontmatter.description;
      }

      if (frontmatter.globs && frontmatter.globs.length > 0) {
        rule.applyTo = frontmatter.globs;
      }

      return rule;
    });

    const toonContent = encode({
      rules,
    });
    lines.push(toonContent);

    return lines.join("\n") + "\n\n";
  }

  private generateReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter(
      (rule) => !rule.isRoot() && !rule.isExcludedFromRootReferences(),
    );

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("Please also reference the following rules as needed:");
    lines.push("");

    for (const toolRule of toolRulesWithoutRoot) {
      // Escape double quotes in description
      const escapedDescription = toolRule.getDescription()?.replace(/"/g, '\\"');
      const globsText = toolRule.getGlobs()?.join(",");

      lines.push(
        `@${toolRule.getRelativePathFromCwd()} description: "${escapedDescription}" applyTo: "${globsText}"`,
      );
    }

    return lines.join("\n") + "\n\n";
  }
}
