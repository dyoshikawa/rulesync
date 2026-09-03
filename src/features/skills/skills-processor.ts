import { basename, dirname, join } from "node:path";

import { encode } from "@toon-format/toon";
import { z } from "zod/mini";

import {
  CURATED_SKILLS_FEATURE_SUBDIR,
  SKILLS_FEATURE_SUBDIR,
} from "../../constants/rulesync-paths.js";
import { AiDir } from "../../types/ai-dir.js";
import { DirFeatureProcessor } from "../../types/dir-feature-processor.js";
import {
  caseFoldIdentity,
  ClaimedIdentities,
  formatCuratedCaseCollisionWarning,
  groupSpellingsByCaseFoldedIdentity,
  mergeByCaseInsensitiveIdentity,
} from "../../types/feature-processor.js";
import { skillsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { quoteForLog, stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import {
  assertWritablePathInsideRoot,
  directoryExists,
  directoryExistsStrict,
  listFileNames,
  listSubdirectoryNames,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { warnOnceWithFallback } from "../../utils/logger.js";
import { AgentsmdSkill } from "./agentsmd-skill.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { AiassistantSkill } from "./aiassistant-skill.js";
import { AmpSkill } from "./amp-skill.js";
import { AntigravityCliSkill } from "./antigravity-cli-skill.js";
import { AntigravityIdeSkill } from "./antigravity-ide-skill.js";
import { AntigravityPluginSkill } from "./antigravity-plugin-skill.js";
import { AugmentcodeSkill } from "./augmentcode-skill.js";
import { ClaudecodePluginSkill } from "./claudecode-plugin-skill.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { ClineSkill } from "./cline-skill.js";
import { CodexCliSkill } from "./codexcli-skill.js";
import { CopilotSkill } from "./copilot-skill.js";
import { CopilotcliSkill } from "./copilotcli-skill.js";
import { CrushSkill } from "./crush-skill.js";
import { CursorSkill } from "./cursor-skill.js";
import { DeepagentsSkill } from "./deepagents-skill.js";
import { DevinSkill } from "./devin-skill.js";
import { FactorydroidSkill } from "./factorydroid-skill.js";
import { GooseSkill } from "./goose-skill.js";
import { GrokcliSkill } from "./grokcli-skill.js";
import { HermesagentSkill } from "./hermesagent-skill.js";
import { JunieSkill } from "./junie-skill.js";
import { KiloSkill } from "./kilo-skill.js";
import { KimiCodeSkill } from "./kimi-code-skill.js";
import { KiroCliSkill } from "./kiro-cli-skill.js";
import { KiroIdeSkill } from "./kiro-ide-skill.js";
import { KiroSkill } from "./kiro-skill.js";
import { MusecodeSkill } from "./musecode-skill.js";
import { OpenCodeSkill } from "./opencode-skill.js";
import { PiSkill } from "./pi-skill.js";
import { QwencodeSkill } from "./qwencode-skill.js";
import { ReasonixSkill } from "./reasonix-skill.js";
import { ReplitSkill } from "./replit-skill.js";
import { RooSkill } from "./roo-skill.js";
import { RovodevSkill } from "./rovodev-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill } from "./simulated-skill.js";
import { getLocalSkillDirNames, isAddressableSkillName } from "./skills-utils.js";
import { TaktSkill } from "./takt-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromFlatFileParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
  isAgentSkillsInteropRoot,
  toolSkillImportRoots,
  toolSkillSearchRoots,
} from "./tool-skill.js";
import { VibeSkill } from "./vibe-skill.js";
import { WarpSkill } from "./warp-skill.js";
import { ZcodeSkill } from "./zcode-skill.js";
import { ZedSkill } from "./zed-skill.js";
import { ZoocodeSkill } from "./zoocode-skill.js";

/**
 * Factory entry for each tool skill class.
 * Stores the class reference and metadata for a tool.
 */
type ToolSkillFactory = {
  class: {
    isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean;
    fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): ToolSkill;
    fromDir(params: ToolSkillFromDirParams): Promise<ToolSkill>;
    /**
     * Optional loader for tools that also discover flat `<name>.md` skills.
     * Directory-form skills are loaded first and take precedence.
     */
    fromFlatFile?(params: ToolSkillFromFlatFileParams): Promise<ToolSkill>;
    forDeletion(params: ToolSkillForDeletionParams): ToolSkill;
    getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths;
    /**
     * Optional import-only hook for roots that cannot be known statically
     * because they are configured in the tool's own config file (e.g.
     * OpenCode's `skills.paths`). Appended after the declared import roots, so
     * a skill of the same name found in a managed root still wins.
     */
    getConfiguredImportRoots?(params: {
      outputRoot: string;
      global: boolean;
      /**
       * For reporting a root that was discovered but cannot be read. A root
       * that simply is not there is not worth a word; one that a scan found and
       * then had to drop is, because the skills in it are silently not
       * imported.
       */
      logger?: Logger;
    }): Promise<Array<{ outputRoot: string; relativeDirPath: string }>>;
    /**
     * Optional content-aware ownership filter for tools whose skills directory
     * is shared with another feature's output (e.g. Reasonix subagent profiles
     * living in `.reasonix/skills/` next to regular skills). When present, the
     * processor calls it for every discovered skill directory — for both
     * import and orphan-deletion enumeration — and skips directories it
     * returns false for.
     */
    isDirOwned?(params: {
      outputRoot: string;
      relativeDirPath: string;
      dirName: string;
      /**
       * The rulesync input roots (in overlay order), for hooks that decide
       * ownership by cross-referencing `.rulesync/` sources (e.g. Devin
       * command slugs). Ownership is decided across every root so an
       * overlay-only command still shadows the same-named skill.
       */
      inputRoots: readonly string[];
      /**
       * The scope being processed, for hooks whose co-owner exists in only one
       * of them (Factory Droid's checks output is project-only, so the same
       * directory name is an ordinary skill in global mode).
       */
      global: boolean;
    }): Promise<boolean>;
    /**
     * Optional write-direction counterpart of `isDirOwned`: the reason this
     * tool must not emit a skill directory of this name, or `null` when it
     * may. A name another feature owns must not be written from a rulesync
     * skill, because `isDirOwned` then refuses to delete it again and the
     * directory outlives the source it came from — so the two hooks have to
     * agree, and they take the same parameters to make keeping them in step
     * straightforward. The reason is logged verbatim, so it must not embed
     * anything read off disk.
     */
    getDirWriteBlockReason?(params: {
      outputRoot: string;
      relativeDirPath: string;
      dirName: string;
      inputRoots: readonly string[];
      global: boolean;
    }): Promise<string | null>;
    /**
     * Opt-in name policy for the flat half of the `--delete` orphan sweep, for
     * a tool that writes one `<name>.md` per skill into a root it shares with
     * the user's own files (TAKT's `.takt/facets/knowledge/`). It answers
     * whether `fileName` is a name this tool could itself have written there;
     * a name it could never have produced is nobody's orphan, and is left
     * alone.
     *
     * Declaring it is what opts a tool into that half of the sweep at all — a
     * tool without it has no flat file considered. It only ever narrows: the
     * derived check that the candidate names back the very file enumerated
     * still decides whether an individual file may go, so declaring this on a
     * directory-based tool cannot make it start deleting files.
     */
    canSweepFlatFileName?(params: { fileName: string }): boolean;
  };
  meta: {
    /** Whether the tool supports project (workspace-level) skills */
    supportsProject: boolean;
    /** Whether the tool supports simulated skills (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) skills */
    supportsGlobal: boolean;
    /**
     * When true, a skill directory that fails to load on import — for any
     * reason (unparseable YAML, invalid frontmatter, unreadable files) — is
     * warned about and skipped instead of aborting the whole import run.
     * Covers both directory-form skills and `fromFlatFile` loaders.
     * Independent of this flag, the Agent Skills interop roots
     * (`.agents/skills/` and equivalents — see
     * {@link isAgentSkillsInteropRoot}) are always imported leniently.
     */
    lenientImport?: boolean;
  };
};

/**
 * Supported tool targets for SkillsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */

export type SkillsProcessorToolTarget = (typeof skillsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const SkillsProcessorToolTargetSchema = z.enum(skillsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their skill factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolSkillFactories = new Map<SkillsProcessorToolTarget, ToolSkillFactory>([
  [
    "agentsmd",
    {
      class: AgentsmdSkill,
      meta: { supportsProject: true, supportsSimulated: true, supportsGlobal: false },
    },
  ],
  [
    "agentsskills",
    {
      // The Agent Skills standard defines `~/.agents/skills/` as the personal/global
      // location in addition to project `.agents/skills/`. https://agentskills.io/specification
      class: AgentsSkillsSkill,
      // The Agent Skills client-implementation guide prescribes lenient
      // per-skill validation: skip a skill whose YAML is unparseable or whose
      // description is missing, log the error, and keep loading the rest.
      // `.agents/skills/` is the cross-vendor directory, so foreign-authored
      // skills are the most likely to be non-conformant.
      // https://agentskills.io/client-implementation/adding-skills-support
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        lenientImport: true,
      },
    },
  ],
  [
    "aiassistant",
    {
      // JetBrains AI Assistant 2026.1 auto-discovers committable project skills
      // from `.agents/skills/<name>/SKILL.md` (the Agent Skills standard). IDE-level
      // skill storage is internal, so only the project scope is supported.
      // https://www.jetbrains.com/help/ai-assistant/agent-skills.html
      class: AiassistantSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "amp",
    {
      // Amp reads Agent Skills from `.agents/skills/` (project) and
      // `~/.config/agents/skills/` (global). https://ampcode.com/manual
      class: AmpSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "antigravity-cli",
    {
      class: AntigravityCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "antigravity-plugin",
    {
      class: AntigravityPluginSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "augmentcode",
    {
      // AugmentCode (Auggie CLI) skills are native Agent Skills directories
      // (<name>/SKILL.md) under .augment/skills/ (project) and
      // ~/.augment/skills/ (global). https://docs.augmentcode.com/cli/skills
      class: AugmentcodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "claudecode-plugin",
    {
      class: ClaudecodePluginSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "cline",
    {
      class: ClineSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "codexcli",
    {
      class: CodexCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "copilot",
    {
      // GitHub Copilot reads project skills from `.github/skills/` and personal
      // skills from `~/.copilot/skills/`, so it supports both project and global.
      class: CopilotSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "copilotcli",
    {
      // Copilot CLI reads project skills from `.github/skills/` and personal
      // skills from `~/.copilot/skills/`, so it supports both project and global.
      class: CopilotcliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "crush",
    {
      // Crush auto-discovers project skills from `.crush/skills/` and global
      // skills from `~/.config/crush/skills/` (or `$CRUSH_SKILLS_DIR`).
      class: CrushSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "cursor",
    {
      class: CursorSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "deepagents",
    {
      // dcode discovers user-level skills in `~/.deepagents/<agent_name>/skills/`.
      class: DeepagentsSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "factorydroid",
    {
      // Factory Droid skills are native SKILL.md files under .factory/skills/
      // (project) and ~/.factory/skills/ (global).
      // https://docs.factory.ai/cli/configuration/skills
      class: FactorydroidSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "goose",
    {
      class: GooseSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentSkill,
      meta: { supportsProject: false, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "grokcli",
    {
      // Grok Build discovers skills under .grok/skills/ (project) and
      // ~/.grok/skills/ (global), each a SKILL.md directory.
      // https://docs.x.ai/build/features/skills-plugins-marketplaces
      class: GrokcliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "junie",
    {
      class: JunieSkill,
      // Junie derives a missing `description` from the body and, when it cannot
      // ("the body is also empty or contains only headings"), fails to load
      // that one skill rather than the whole set. Importing follows suit: the
      // skill is skipped with a warning instead of aborting the run.
      // https://junie.jetbrains.com/docs/agent-skills.html
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        lenientImport: true,
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "kimi-code",
    {
      class: KimiCodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "kiro",
    {
      class: KiroSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    // Kiro reads skills from `.kiro/skills/` (project) and `~/.kiro/skills/`
    // (global). https://kiro.dev/docs/skills/
    "kiro-cli",
    {
      class: KiroCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "kiro-ide",
    {
      class: KiroIdeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "musecode",
    {
      // Muse Code reads Agent Skills from `.agents/skills/` (project) and from
      // `$XDG_CONFIG_HOME/muse/skills` / `~/.agents/skills` (user). Only the
      // XDG-default `~/.config/muse/skills` is emitted at global scope.
      // https://dev.meta.ai/docs/muse-code/extending.md
      class: MusecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "pi",
    {
      class: PiSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "qwencode",
    {
      // Qwen Code Agent Skills are directories (`<name>/SKILL.md`) under
      // `.qwen/skills/` (project) / `~/.qwen/skills/` (personal/global).
      class: QwencodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "reasonix",
    {
      // DeepSeek-Reasonix discovers directory-layout skills (<name>/SKILL.md)
      // under .reasonix/skills/ (project) and ~/.reasonix/skills/ (global).
      // https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
      class: ReasonixSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "replit",
    {
      // Replit Agent Skills document a user-level (personal) scope and follow the
      // open Agent Skills standard, which defines `.agents/skills/` (project) and
      // `~/.agents/skills/` (personal/global).
      // https://docs.replit.com/features/agent/skills (user-level scope)
      // https://agentskills.io/specification (`~/.agents/skills/` personal path)
      class: ReplitSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "roo",
    {
      class: RooSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "zoocode",
    {
      // Zoo Code keeps Roo's skills layout and `roo:` frontmatter section.
      class: ZoocodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "takt",
    {
      class: TaktSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "vibe",
    {
      // Vibe follows the Agent Skills format and discovers skills from
      // `.vibe/skills/` and `.agents/skills/` at project scope, and from
      // `~/.vibe/skills/` and `~/.agents/skills/` at user scope.
      class: VibeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "warp",
    {
      class: WarpSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "devin",
    {
      class: DevinSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "zcode",
    {
      class: ZcodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "zed",
    {
      class: ZedSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: SkillsProcessorToolTarget) => ToolSkillFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolSkillFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolSkillFactories.keys()];

const skillsProcessorToolTargetsProject: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsProject ?? true;
});

const skillsProcessorToolTargetsSimulated: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsSimulated ?? false;
});

export const skillsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

export class SkillsProcessor extends DirFeatureProcessor {
  private readonly toolTarget: SkillsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({
      outputRoot,
      inputRoots,
      dryRun,
      avoidBlockScalars: toolTarget === "cursor",
      logger,
    });
    const result = SkillsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SkillsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncDirsToToolDirs(rulesyncDirs: AiDir[]): Promise<AiDir[]> {
    const rulesyncSkills = rulesyncDirs.filter(
      (dir): dir is RulesyncSkill => dir instanceof RulesyncSkill,
    );

    const factory = this.getFactory(this.toolTarget);

    const toolSkills = (
      await Promise.all(
        rulesyncSkills.map(async (rulesyncSkill) => {
          const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
          const isClaudecodeScheduledTask =
            rulesyncFrontmatter.claudecode?.["scheduled-task"] === true;
          if (
            isClaudecodeScheduledTask &&
            this.toolTarget !== "claudecode" &&
            this.toolTarget !== "claudecode-legacy"
          ) {
            return null;
          }
          if (!factory.class.isTargetedByRulesyncSkill(rulesyncSkill)) {
            return null;
          }
          const dirName = rulesyncSkill.getDirName();
          const dirWriteBlockReason = await factory.class.getDirWriteBlockReason?.({
            outputRoot: this.outputRoot,
            relativeDirPath: factory.class.getSettablePaths({ global: this.global })
              .relativeDirPath,
            dirName,
            inputRoots: this.inputRoots,
            global: this.global,
          });
          if (dirWriteBlockReason !== undefined && dirWriteBlockReason !== null) {
            // Another feature owns this output directory, so the skills feature
            // never deletes it either: writing it here would leave a directory
            // that outlives the rulesync skill it came from. The name is quoted
            // and stripped because whoever wrote the repository chose it.
            this.logger.warn(
              `Skipping skill ${quoteForLog(dirName)} for ` +
                `'${this.toolTarget}': ${dirWriteBlockReason}`,
            );
            return null;
          }
          return factory.class.fromRulesyncSkill({
            outputRoot: this.outputRoot,
            rulesyncSkill: rulesyncSkill,
            global: this.global,
            logger: this.logger,
          });
        }),
      )
    ).filter((skill): skill is ToolSkill => skill !== null);

    return toolSkills;
  }

  async convertToolDirsToRulesyncDirs(toolDirs: AiDir[]): Promise<AiDir[]> {
    const toolSkills = toolDirs.filter((dir): dir is ToolSkill => dir instanceof ToolSkill);

    const rulesyncSkills: RulesyncSkill[] = [];
    for (const toolSkill of toolSkills) {
      // Skip simulated skills as they cannot be converted back
      if (toolSkill instanceof SimulatedSkill) {
        this.logger.debug(`Skipping simulated skill conversion: ${toolSkill.getDirPath()}`);
        continue;
      }
      rulesyncSkills.push(toolSkill.toRulesyncSkill());
    }

    return rulesyncSkills;
  }

  /**
   * Load rulesync skill directories from a single source-tree's `skills/`
   * (and `skills/.curated/`) subtree. `sourceTree` is the source tree
   * itself (e.g. `/repo/.rulesync` or `/repo/.rulesync.local`). Intra-tree:
   * local skills take precedence over curated skills with the same name.
   */
  private async loadRulesyncDirsForRoot(sourceTree: string): Promise<RulesyncSkill[]> {
    const treeParent = dirname(sourceTree);
    const treeName = basename(sourceTree);
    const treeSkillsDirPath = join(treeName, SKILLS_FEATURE_SUBDIR);
    const treeCuratedSkillsDirPath = join(treeName, CURATED_SKILLS_FEATURE_SUBDIR);
    const localDirNames = this.keepAddressableNames({
      names: [...(await getLocalSkillDirNames(sourceTree))],
      dirPath: join(treeParent, treeSkillsDirPath),
      kind: "directory",
    });

    const localSkills = await Promise.all(
      localDirNames.map((dirName) =>
        RulesyncSkill.fromDir({
          outputRoot: treeParent,
          relativeDirPath: treeSkillsDirPath,
          dirName,
          global: this.global,
        }),
      ),
    );

    // Keyed by case-folded name because two skill directories whose names
    // differ only in case collapse onto one directory on macOS/Windows.
    const localSkillNamesByIdentity = groupSpellingsByCaseFoldedIdentity(localDirNames);

    const curatedDirPath = join(sourceTree, CURATED_SKILLS_FEATURE_SUBDIR);
    let curatedSkills: RulesyncSkill[] = [];

    // Strict for the same reason as the local skills directory above: a
    // curated tree that cannot be resolved must not read as "no curated
    // skills".
    if (await directoryExistsStrict(curatedDirPath)) {
      const curatedDirNames = this.keepAddressableNames({
        names: await listSubdirectoryNames(curatedDirPath),
        dirPath: curatedDirPath,
        kind: "directory",
      });

      const nonConflicting = curatedDirNames.filter((name) => {
        const spellings = localSkillNamesByIdentity.get(caseFoldIdentity(name));

        if (spellings === undefined) {
          return true;
        }

        // An exact match is the documented local-wins-over-curated flow and
        // stays at debug level; a case-only match is ambiguous enough to
        // surface, mirroring the warning the cross-root merge emits. The exact
        // spelling is preferred so an unrelated case variant sitting next to
        // it does not turn a plain override into a spurious collision warning.
        if (spellings.includes(name)) {
          this.logger.debug(`Skipping curated skill "${name}": local skill takes precedence.`);
        } else {
          this.logger.warn(
            formatCuratedCaseCollisionWarning({
              artifactKind: "skill",
              entryNoun: "skill",
              treeDirPath: treeSkillsDirPath,
              curatedSpelling: name,
              localSpellings: spellings,
            }),
          );
        }

        return false;
      });

      curatedSkills = await Promise.all(
        nonConflicting.map((dirName) =>
          RulesyncSkill.fromDir({
            outputRoot: treeParent,
            relativeDirPath: treeCuratedSkillsDirPath,
            dirName,
            global: this.global,
          }),
        ),
      );
    }

    return [...localSkills, ...curatedSkills];
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor.
   *
   * Load and parse rulesync skill directories from every configured input
   * root's `.rulesync/skills/` tree (each root also honours its own
   * `.curated/` subdirectory). When two roots supply a skill with the same
   * directory name, the later root's skill replaces the earlier root's copy
   * atomically (companion files included) — an overlay always ships a whole
   * skill directory, never a partial patch.
   */
  async loadRulesyncDirs(): Promise<AiDir[]> {
    const perRoot = await Promise.all(
      this.inputRoots.map((root) => this.loadRulesyncDirsForRoot(root)),
    );

    const allSkills = mergeByCaseInsensitiveIdentity({
      perRoot,
      identity: (skill) => skill.getDirName(),
      artifactName: "skill",
      logger: this.logger,
    });

    this.logger.debug(`Successfully loaded ${allSkills.length} rulesync skills`);

    return allSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load tool-specific skill configurations and parse them into ToolSkill instances
   */
  async loadToolDirs(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const configuredRoots = factory.class.getConfiguredImportRoots
      ? await factory.class.getConfiguredImportRoots({
          outputRoot: this.outputRoot,
          global: this.global,
          logger: this.logger,
        })
      : [];
    const configuredRootPaths = new Set(configuredRoots.map((root) => root.relativeDirPath));
    const roots = [...toolSkillImportRoots(paths), ...configuredRoots];

    // Roots are scanned in precedence order and the first spelling of a name
    // wins. Case is folded because the skills are written back into a single
    // `.rulesync/skills/` tree, where two spellings of one name are one
    // directory on macOS and Windows.
    const claimedSkillNames = new ClaimedIdentities();
    // An exact repeat is an ordinary overlay and stays quiet, as it always
    // has. A collision that differs only in case is reported, because the
    // ignored copy is not the one whose name the user would search for — and
    // because on a case-sensitive filesystem, where the two really are
    // separate skills, this is the only sign that one of them was dropped.
    const claimSkillName = ({
      skill,
      relativeDirPath,
      sourcePath,
    }: {
      skill: ToolSkill;
      relativeDirPath: string;
      sourcePath: string;
    }): boolean => {
      const skillName = skill.getImportIdentity();
      const claimed = claimedSkillNames.claim({ identity: skillName, source: relativeDirPath });
      if (claimed === null) {
        return true;
      }
      if (claimed.spelling !== skillName) {
        this.logger.warn(
          `Case-insensitive ${this.toolTarget} skill collision: "${claimed.spelling}" and ` +
            `"${skillName}" resolve to the same skill directory. Keeping "${claimed.spelling}" ` +
            `from ${claimed.source === relativeDirPath ? "earlier in the same root" : `the higher-precedence ${claimed.source}`} ` +
            `and ignoring ${sourcePath}, which is not imported.`,
        );
      }
      return false;
    };
    const toolSkills: ToolSkill[] = [];
    for (const root of roots) {
      const rootOutputRoot = typeof root === "string" ? this.outputRoot : root.outputRoot;
      const relativeDirPath = typeof root === "string" ? root : root.relativeDirPath;
      const isConfiguredRoot = configuredRootPaths.has(relativeDirPath);
      // A root the tool's own config points at is arbitrary user territory,
      // the Agent Skills interop roots hold foreign-authored skills, and tools
      // flagged `lenientImport` follow the Agent Skills guide's
      // lenient-validation prescription for every root — in all three cases
      // one bad skill must not take the whole import (and every feature after
      // it) down, so it is skipped with a warning instead.
      const isLenientRoot =
        isConfiguredRoot ||
        factory.meta.lenientImport === true ||
        isAgentSkillsInteropRoot(relativeDirPath);
      const skillsDirPath = join(rootOutputRoot, relativeDirPath);
      if (!(await directoryExists(skillsDirPath))) {
        continue;
      }
      const ownedDirNames: string[] = [];
      const candidateDirNames = this.keepAddressableNames({
        names: await listSubdirectoryNames(skillsDirPath),
        dirPath: skillsDirPath,
        kind: "directory",
      });
      for (const dirName of candidateDirNames) {
        if (
          !(await this.isOwnedSkillDir({
            factory,
            outputRoot: rootOutputRoot,
            relativeDirPath,
            dirName,
          }))
        ) {
          continue;
        }
        ownedDirNames.push(dirName);
      }

      const directorySkills = (
        await Promise.all(
          ownedDirNames.map(async (dirName) => {
            // The source path travels with the skill because a warning has to
            // name the file on disk, and `getImportIdentity()` is not always
            // the directory name (Kimi Code derives it from frontmatter).
            const sourcePath = join(relativeDirPath, dirName);
            try {
              return {
                skill: await factory.class.fromDir({
                  outputRoot: rootOutputRoot,
                  relativeDirPath,
                  dirName,
                  global: this.global,
                }),
                sourcePath,
              };
            } catch (error) {
              if (!isLenientRoot) {
                throw error;
              }
              this.logger.warn(
                `Skipping ${quoteForLog(sourcePath)}: ` +
                  // The error names the same path, so it is stripped too.
                  stripControlCharacters(formatError(error)),
              );
              return null;
            }
          }),
        )
      ).filter((loaded) => loaded !== null);
      for (const { skill, sourcePath } of directorySkills) {
        if (claimSkillName({ skill, relativeDirPath, sourcePath })) {
          toolSkills.push(skill);
        }
      }

      if (!factory.class.fromFlatFile) {
        continue;
      }
      const fromFlatFile = factory.class.fromFlatFile;
      const directoryStems = new Set(ownedDirNames);
      const flatFileNames = this.keepAddressableNames({
        // The suffix is applied while reading rather than after, so a `.md`
        // name that stands for a file of another name is not collapsed onto
        // that file and dropped by the filter.
        names: (
          await listFileNames(skillsDirPath, { nameFilter: (name) => name.endsWith(".md") })
        ).filter((fileName) => !directoryStems.has(basename(fileName, ".md"))),
        dirPath: skillsDirPath,
        kind: "file",
      });
      const flatSkills = (
        await Promise.all(
          flatFileNames.map(async (fileName) => {
            const sourcePath = join(relativeDirPath, fileName);
            try {
              return {
                skill: await fromFlatFile({
                  outputRoot: rootOutputRoot,
                  relativeDirPath,
                  relativeFilePath: fileName,
                  global: this.global,
                }),
                sourcePath,
              };
            } catch (error) {
              // Same tolerance as the directory-form loads above.
              if (!isLenientRoot) {
                throw error;
              }
              this.logger.warn(
                `Skipping ${quoteForLog(sourcePath)}: ` +
                  // The error names the same path, so it is stripped too.
                  stripControlCharacters(formatError(error)),
              );
              return null;
            }
          }),
        )
      ).filter((loaded) => loaded !== null);
      for (const { skill, sourcePath } of flatSkills) {
        if (claimSkillName({ skill, relativeDirPath, sourcePath })) {
          toolSkills.push(skill);
        }
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolSkills.length} skills from ${roots.length} root(s)`,
    );
    return toolSkills;
  }

  /**
   * Drop the names nothing here can address, reporting each one. A flat-file
   * skill is named by its file name minus the extension, and that name reaches
   * `AiDir` exactly as a directory name does. See {@link isAddressableName} for
   * why such an entry can exist at all.
   *
   * The path reported is the one on disk rather than the name alone: the same
   * relative root exists in both the project and the home directory, and a run
   * that reads both would otherwise report only whichever it reached first.
   */
  private keepAddressableNames(params: {
    names: string[];
    dirPath: string;
    kind: "directory" | "file";
  }): string[] {
    const { names, dirPath, kind } = params;
    return names.filter((name) => {
      if (isAddressableSkillName(kind === "file" ? basename(name, ".md") : name)) {
        return true;
      }
      const consequence =
        kind === "file"
          ? `skill name cannot contain a path separator, so this file is neither imported nor ` +
            `swept as an orphan. Rename it by hand.`
          : `skill directory name cannot contain a path separator, so this directory is neither ` +
            `generated from nor swept as an orphan. Rename or remove it by hand.`;
      // Once per run, not once per tool target: the message names an entry on
      // disk, and every enabled target enumerates that same directory. Quoted
      // and stripped like every other message naming a path that came off disk
      // — the name is chosen by whoever wrote the repository. The quoting
      // doubles the backslash the message is about, which is what reading a
      // quoted string means.
      warnOnceWithFallback(
        this.logger,
        `Skipping ${quoteForLog(join(dirPath, name))}: a ${consequence}`,
      );
      return false;
    });
  }

  /**
   * Whether a skill directory in a shared root belongs to this feature at all,
   * via the optional `isDirOwned` factory hook. A tool without the hook owns
   * everything it finds. Shared by import and by both halves of the orphan
   * sweep, so ownership is decided the same way in all three — a directory
   * another feature generated (a Reasonix subagent profile in
   * `.reasonix/skills/`, a Devin command on the skills surface) is neither
   * imported as a skill nor deleted as an orphan one.
   */
  private async isOwnedSkillDir({
    factory,
    outputRoot,
    relativeDirPath,
    dirName,
  }: {
    factory: ToolSkillFactory;
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
  }): Promise<boolean> {
    if (factory.class.isDirOwned === undefined) {
      return true;
    }
    return await factory.class.isDirOwned({
      outputRoot,
      relativeDirPath,
      dirName,
      inputRoots: this.inputRoots,
      global: this.global,
    });
  }

  /**
   * The tool's skills roots that exist on disk, each paired with its absolute
   * path and vetted as writable inside this run's output root. Shared by the
   * two halves of the orphan sweep so both look in exactly the same places,
   * under exactly the same guard.
   */
  private async loadExistingSkillsRoots(
    paths: ToolSkillSettablePaths,
  ): Promise<Array<{ root: string; skillsDirPath: string }>> {
    const existingRoots: Array<{ root: string; skillsDirPath: string }> = [];
    for (const root of toolSkillSearchRoots(paths)) {
      const skillsDirPath = join(this.outputRoot, root);
      if (!(await directoryExists(skillsDirPath))) {
        continue;
      }
      await assertWritablePathInsideRoot({
        rootPath: this.outputRoot,
        targetPath: skillsDirPath,
      });
      existingRoots.push({ root, skillsDirPath });
    }
    return existingRoots;
  }

  async loadToolDirsToDelete(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const roots = toolSkillSearchRoots(paths);

    const toolSkills: AiDir[] = [];
    for (const { root, skillsDirPath } of await this.loadExistingSkillsRoots(paths)) {
      const dirNames = this.keepAddressableNames({
        names: await listSubdirectoryNames(skillsDirPath, { followSymbolicLinks: false }),
        dirPath: skillsDirPath,
        kind: "directory",
      });
      for (const dirName of dirNames) {
        await assertWritablePathInsideRoot({
          rootPath: skillsDirPath,
          targetPath: join(skillsDirPath, dirName),
        });
        if (
          !(await this.isOwnedSkillDir({
            factory,
            outputRoot: this.outputRoot,
            relativeDirPath: root,
            dirName,
          }))
        ) {
          continue;
        }
        const toolSkill = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: root,
          dirName,
          global: this.global,
        });
        toolSkills.push(toolSkill);
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolSkills.length} skills for deletion under ${roots.join(", ")}`,
    );
    return toolSkills;
  }

  /**
   * The flat `<name>.md` skill files to consider for deletion, for a tool that
   * writes one file per skill into a shared facet root (TAKT's
   * `.takt/facets/knowledge/`) instead of a directory per skill. Those files
   * are invisible to {@link loadToolDirsToDelete}, which enumerates
   * subdirectories — of which such a tool creates none.
   *
   * A directory-based tool contributes nothing here: it declares no
   * `canSweepFlatFileName` policy, so its roots are never listed, and a
   * candidate built for one of its `.md` files would name a directory of its
   * own rather than that file anyway. A stray Markdown file next to its skill
   * directories is not a skill of its, and must not be swept as one.
   */
  override async loadToolFlatFilesToDelete(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    // Bound to the class, so a policy that grows a `this.` reference later
    // keeps working: it is called from inside a filter callback, where an
    // unbound static would be called with no receiver at all.
    const canSweepFlatFileName = factory.class.canSweepFlatFileName?.bind(factory.class);
    // Opt-in, and the opt-in is the whole gate: a tool that declares no name
    // policy for this root has no flat file of its considered, and its roots
    // are not even listed. That is what every directory-based tool wants —
    // a stray Markdown file next to its skill directories is not a skill of
    // its, and must not be swept as one.
    if (canSweepFlatFileName === undefined) {
      return [];
    }
    const paths = factory.class.getSettablePaths({ global: this.global });
    const roots = toolSkillSearchRoots(paths);

    const toolSkills: AiDir[] = [];
    for (const { root, skillsDirPath } of await this.loadExistingSkillsRoots(paths)) {
      const fileNames = this.keepAddressableNames({
        // Symbolic links are left out, as they are for the directory half of
        // the sweep: a link that happens to share a generated file's name is
        // not that file, and removing it deletes something rulesync never
        // wrote there. Hidden files are left out for the same reason
        // `listFileNames` omits them everywhere else: a dotfile in the root is
        // the tool's or the editor's, never a skill this run wrote.
        names: await listFileNames(skillsDirPath, {
          nameFilter: (name) => name.endsWith(".md") && canSweepFlatFileName({ fileName: name }),
          followSymbolicLinks: false,
        }),
        dirPath: skillsDirPath,
        kind: "file",
      });
      for (const fileName of fileNames) {
        const filePath = join(skillsDirPath, fileName);
        await assertWritablePathInsideRoot({
          rootPath: skillsDirPath,
          targetPath: filePath,
        });
        // The stem is the skill's name for a tool that writes `<name>.md`,
        // which is why the enumeration above is limited to `.md` in the first
        // place: it is what the candidate is built from.
        const dirName = basename(fileName, ".md");
        const toolSkill = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: root,
          dirName,
          global: this.global,
        });
        // The candidate has to name back the very file it was built from.
        // That is false for a directory-based tool (it names a directory
        // instead, and `getFlatFilePath()` returns nothing), and false for a
        // flat one whose file name is not the stem plus `.md` — in which case
        // the file it does name is not the one enumerated here, and sweeping
        // it would delete an unrelated entry. Derived rather than declared, so
        // a tool that declares the name policy but does not actually flatten
        // still sweeps nothing.
        if (toolSkill.getFlatFilePath() !== filePath) {
          continue;
        }
        // Same ownership hook as the directory half. No tool declares both it
        // and a flat-name policy today; it is here so that adding an ownership
        // filter to a flattening tool takes effect on the sweep rather than
        // being quietly ignored.
        if (
          !(await this.isOwnedSkillDir({
            factory,
            outputRoot: this.outputRoot,
            relativeDirPath: root,
            dirName,
          }))
        ) {
          continue;
        }
        toolSkills.push(toolSkill);
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolSkills.length} flat skill files for deletion under ` +
        `${roots.join(", ")}`,
    );
    return toolSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false,
  }: {
    global?: boolean;
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (global) {
      return skillsProcessorToolTargetsGlobal;
    }
    const projectTargets = skillsProcessorToolTargetsProject;
    if (!includeSimulated) {
      return projectTargets.filter(
        (target) => !skillsProcessorToolTargetsSimulated.includes(target),
      );
    }
    return projectTargets;
  }

  /**
   * Return the simulated tool targets
   */
  static getToolTargetsSimulated(): ToolTarget[] {
    return skillsProcessorToolTargetsSimulated;
  }

  /**
   * Convention section describing simulated skills, embedded into a tool's root
   * rule (e.g. AGENTS.md) by the rules feature. Returns an empty string when there
   * are no skills to list.
   */
  static getSimulatedConventionSection({
    skillList,
  }: {
    skillList?: Array<{ name: string; description: string; path: string }>;
  }): string {
    if (!skillList || skillList.length === 0) {
      return "";
    }

    const skillListWithAtPrefix = skillList.map((skill) => ({
      ...skill,
      path: `@${skill.path}`,
    }));
    const toonContent = encode({ skillList: skillListWithAtPrefix });

    return `## Simulated Skills

Simulated skills are specialized capabilities that can be invoked to handle specific types of tasks. When you determine that a skill would be helpful for the current task, read the corresponding SKILL.md file and execute its instructions.

${toonContent}`;
  }

  /**
   * Return the tool targets that this processor supports in global mode
   */
  static getToolTargetsGlobal(): ToolTarget[] {
    return skillsProcessorToolTargetsGlobal;
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid SkillsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolSkillFactory | undefined {
    // Validate that target is supported
    const result = SkillsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolSkillFactories.get(result.data);
  }
}
