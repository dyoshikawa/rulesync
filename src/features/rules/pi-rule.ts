import { join } from "node:path";

import { PI_APPEND_SYSTEM_FILE_NAME, PI_DIR, PI_RULE_FILE_NAME } from "../../constants/pi-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type PiRuleParams = AiFileParams & {
  root?: boolean;
  /** Marks an instance whose body maps to Pi's append system-prompt file. */
  appendSystemPrompt?: boolean;
};

export type PiRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
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
 * `undefined`). This mirrors the codexcli, grokcli, warp, and deepagents targets.
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

  constructor({ fileContent, root, appendSystemPrompt = false, ...rest }: PiRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
    this.appendSystemPrompt = appendSystemPrompt;
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): PiRuleSettablePaths {
    return {
      root: {
        relativeDirPath: global ? buildToolPath(PI_DIR, "agent", excludeToolDir) : ".",
        relativeFilePath: PI_RULE_FILE_NAME,
      },
      appendSystemPrompt: {
        // Project scope: `.pi/APPEND_SYSTEM.md`. Global scope: same `.pi/agent`
        // directory as the global root AGENTS.md.
        relativeDirPath: global ? buildToolPath(PI_DIR, "agent", excludeToolDir) : PI_DIR,
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
    return [this.getSettablePaths({ global }).appendSystemPrompt];
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

    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new PiRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): PiRule {
    const { root, appendSystemPrompt } = this.getSettablePaths({ global });
    const frontmatter = rulesyncRule.getFrontmatter();

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

    const isRoot =
      relativeFilePath === PI_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === root.relativeDirPath);

    return new PiRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "pi",
    });
  }
}
