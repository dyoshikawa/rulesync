import { join } from "node:path";

import {
  PI_APPEND_SYSTEM_FILE_NAME,
  PI_DIR,
  PI_RULE_FILE_NAME,
  PI_RULE_OVERRIDE_FILE_NAME,
} from "../../constants/pi-paths.js";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule, formatRulePaths } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleRootOnlySettablePaths,
} from "./tool-rule.js";

export type PiRuleParams = AiFileParams & {
  root?: boolean;
  /** Marks an instance whose body maps to Pi's append system-prompt file. */
  appendSystemPrompt?: boolean;
  /** Marks a root instance written as `AGENTS.override.md`. */
  contextFileOverride?: boolean;
};

export type PiRuleSettablePaths = ToolRuleRootOnlySettablePaths & {
  /**
   * Pi's *append* system-prompt file. Rules opt into this path via the
   * `pi.systemPrompt: append` frontmatter block; multiple opted-in rules are
   * concatenated into this single file by the RulesProcessor.
   */
  appendSystemPrompt: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

/**
 * Rule generator for Pi Coding Agent.
 *
 * Pi loads instruction context from the `AGENTS.md` / `CLAUDE.md` family —
 * the global `~/.pi/agent/AGENTS.md` plus files discovered by walking up the
 * directory tree from the current working directory. It does NOT resolve
 * `@`-imports or a TOON file list, and has no `.agents/memories/` concept, so
 * non-root rule bodies written to a subdirectory are never read.
 * (Verified against the official docs: https://pi.dev/docs/latest/usage)
 *
 * rulesync's topic-based non-root rules therefore have no project subdirectory
 * to map onto; their bodies are folded into the single root `AGENTS.md` by the
 * RulesProcessor (there is no separate non-root output location — `nonRoot` is
 * `undefined`). This mirrors the codexcli, warp and deepagents targets.
 *
 * Pi also loads two system-prompt instruction files. `.pi/APPEND_SYSTEM.md`
 * (global `~/.pi/agent/APPEND_SYSTEM.md`) *appends* to the default system prompt,
 * and rulesync emits it from any rule that opts in via the `pi.systemPrompt:
 * append` frontmatter block: those bodies are routed here instead of being folded
 * into `AGENTS.md`, and multiple opted-in rules concatenate in source order.
 * `.pi/SYSTEM.md` (global `~/.pi/agent/SYSTEM.md`) *replaces* the default system
 * prompt entirely — which silently disables Pi's built-in tool instructions — so
 * rulesync deliberately never emits it and leaves it to be authored by hand.
 * See docs/reference/file-formats.md.
 */
export class PiRule extends ToolRule {
  private readonly appendSystemPrompt: boolean;
  private readonly contextFileOverride: boolean;

  constructor({
    fileContent,
    root,
    appendSystemPrompt = false,
    contextFileOverride = false,
    ...rest
  }: PiRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
    this.appendSystemPrompt = appendSystemPrompt;
    this.contextFileOverride = contextFileOverride;
  }

  static getSettablePaths({
    global = false,
    contextFile,
  }: {
    global?: boolean;
    /** `"override"` emits the root context file as `AGENTS.override.md`. */
    contextFile?: "override" | undefined;
  } = {}): PiRuleSettablePaths {
    return {
      root: {
        relativeDirPath: global ? join(PI_DIR, "agent") : ".",
        relativeFilePath:
          contextFile === "override" ? PI_RULE_OVERRIDE_FILE_NAME : PI_RULE_FILE_NAME,
      },
      appendSystemPrompt: {
        // Project scope: `.pi/APPEND_SYSTEM.md`. Global scope: same `.pi/agent`
        // directory as the global root AGENTS.md.
        relativeDirPath: global ? join(PI_DIR, "agent") : PI_DIR,
        relativeFilePath: PI_APPEND_SYSTEM_FILE_NAME,
      },
    };
  }

  /**
   * Extra fixed files this tool manages beyond the root rule. The
   * RulesProcessor enumerates these for import and deletion so a stale
   * `APPEND_SYSTEM.md` is cleaned up once no rule opts in anymore.
   */
  static getExtraFixedFiles({
    global = false,
  }: { global?: boolean } = {}): ToolRuleExtraFixedFile[] {
    // `AGENTS.override.md` is enumerated here rather than only as the root
    // path: it is Pi-exclusive, so it can be imported and — once no rule opts
    // in any more — deleted, without ever touching the shared `AGENTS.md` that
    // other targets also write.
    return [
      this.getSettablePaths({ global }).appendSystemPrompt,
      this.getSettablePaths({ global, contextFile: "override" }).root,
    ];
  }

  /**
   * The project-root `AGENTS.md` is written by several other targets
   * (agentsmd, codexcli, warp, devin, ...), and the root-file ownership map that
   * arbitrates a shared path only applies to `--check`. With
   * `pi.contextFile: override` Pi stops writing that file, so leaving it on the
   * orphan list would make every `pi` generate delete another target's freshly
   * written output. The global `~/.pi/agent/AGENTS.md` is Pi-exclusive and stays
   * deletable.
   */
  override isDeletable(): boolean {
    return !(this.getRelativeDirPath() === "." && this.getRelativeFilePath() === PI_RULE_FILE_NAME);
  }

  /**
   * Pi appends `APPEND_SYSTEM.md` to the system prompt itself, so listing it in
   * the root rule's reference section (toon/explicit discovery modes) would
   * double-load the content.
   */
  override isExcludedFromRootReferences(): boolean {
    return this.appendSystemPrompt;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<PiRule> {
    const { root, appendSystemPrompt } = this.getSettablePaths({ global });

    // Route the append system-prompt file to its own instance; everything else
    // resolves to the single root AGENTS.md.
    if (relativeFilePath === PI_APPEND_SYSTEM_FILE_NAME) {
      const relativePath = join(
        appendSystemPrompt.relativeDirPath,
        appendSystemPrompt.relativeFilePath,
      );
      const fileContent = await readFileContent(join(outputRoot, relativePath));

      return new PiRule({
        outputRoot,
        relativeDirPath: appendSystemPrompt.relativeDirPath,
        relativeFilePath: appendSystemPrompt.relativeFilePath,
        fileContent,
        validate,
        root: false,
        appendSystemPrompt: true,
      });
    }

    // `AGENTS.override.md` is the root context file too — Pi reads it *instead
    // of* `AGENTS.md` — so it imports back as the root rule carrying the flag.
    const isOverride = relativeFilePath === PI_RULE_OVERRIDE_FILE_NAME;
    const rootPaths = isOverride
      ? this.getSettablePaths({ global, contextFile: "override" }).root
      : root;

    const relativePath = join(rootPaths.relativeDirPath, rootPaths.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new PiRule({
      outputRoot,
      relativeDirPath: rootPaths.relativeDirPath,
      relativeFilePath: rootPaths.relativeFilePath,
      fileContent,
      validate,
      root: true,
      contextFileOverride: isOverride,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): PiRule {
    const frontmatter = rulesyncRule.getFrontmatter();
    const { root, appendSystemPrompt } = this.getSettablePaths({
      global,
      contextFile: frontmatter.pi?.contextFile,
    });

    // Opted-in rules route to the append system-prompt file instead of AGENTS.md.
    // The root rule always stays on AGENTS.md: routing it away would leave the
    // context file without a merge/localRoot target, so `pi.systemPrompt` is
    // ignored on a `root: true` rule (documented in file-formats.md).
    if (!frontmatter.root && frontmatter.pi?.systemPrompt === "append") {
      return new PiRule({
        outputRoot,
        relativeDirPath: appendSystemPrompt.relativeDirPath,
        relativeFilePath: appendSystemPrompt.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: false,
        appendSystemPrompt: true,
      });
    }

    const isRoot = frontmatter.root ?? false;

    return new PiRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
      contextFileOverride: frontmatter.pi?.contextFile === "override",
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.appendSystemPrompt) {
      return new RulesyncRule({
        outputRoot: process.cwd(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: PI_APPEND_SYSTEM_FILE_NAME,
        frontmatter: {
          root: false,
          targets: ["pi"],
          pi: { systemPrompt: "append" },
        },
        body: this.getFileContent(),
      });
    }
    if (this.contextFileOverride) {
      return new RulesyncRule({
        outputRoot: process.cwd(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        frontmatter: {
          root: true,
          targets: ["pi"],
          globs: ["**/*"],
          pi: { contextFile: "override" },
        },
        body: this.getFileContent(),
      });
    }
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Pi rules are plain markdown files without complex frontmatter,
    // so any body content is considered valid.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): PiRule {
    const { root } = this.getSettablePaths({ global });

    if (relativeFilePath === PI_APPEND_SYSTEM_FILE_NAME) {
      return new PiRule({
        outputRoot,
        relativeDirPath,
        relativeFilePath,
        fileContent: "",
        validate: false,
        root: false,
        appendSystemPrompt: true,
      });
    }

    // Both context-file spellings are root files: toggling `pi.contextFile`
    // must let the abandoned one be cleaned up rather than left behind next to
    // the new one.
    const isOverride = relativeFilePath === PI_RULE_OVERRIDE_FILE_NAME;
    const isRoot =
      (relativeFilePath === PI_RULE_FILE_NAME || isOverride) &&
      (relativeDirPath === "." || relativeDirPath === root.relativeDirPath);

    return new PiRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
      contextFileOverride: isOverride,
    });
  }

  /**
   * Pi reads `AGENTS.override.md` *instead of* `AGENTS.md` from a directory, and
   * non-root Pi rules are folded into whichever file the root emits. A mix of
   * opted-in and opted-out rules would therefore split the output across both
   * files and let Pi silently ignore everything in `AGENTS.md`, so the root rule
   * decides for all of them: its `pi.contextFile` is copied onto the non-root
   * rules, and the flag set only on a non-root rule is dropped with a warning.
   */
  static alignRulesyncRules(rules: RulesyncRule[]): {
    rules: RulesyncRule[];
    warnings: string[];
  } {
    const targeted = rules.filter((rule) => this.isTargetedByRulesyncRule(rule));
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
    if (mismatched.length === 0) return { rules, warnings: [] };

    const warnings =
      rootContextFile === undefined
        ? [
            `pi.contextFile is set on ${mismatched.length} non-root rule(s) but not on the root rule, ` +
              `so it is ignored: Pi folds every rule body into the root context file, and emitting ` +
              `AGENTS.override.md for some of them would hide the rest. Set it on the root rule ` +
              `instead: ${formatRulePaths(mismatched)}`,
          ]
        : [];

    const mismatchedSet = new Set(mismatched);
    const alignedRules = rules.map((rule) => {
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
    return { rules: alignedRules, warnings };
  }

  protected static override readonly toolTarget = "pi";
}
