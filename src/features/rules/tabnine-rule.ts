import { join } from "node:path";

import {
  TABNINE_AGENT_DIR_PATH,
  TABNINE_DIR,
  TABNINE_RULE_FILE_NAME,
} from "../../constants/tabnine-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type TabnineRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Tabnine CLI.
 *
 * - Project scope: `TABNINE.md` at the project root is the CLI's memory file
 *   (loaded on every session, refreshed with `/memory reload`). Non-root
 *   rules go to `.tabnine/guidelines/*.md`, the guideline directory the
 *   Tabnine IDE agent reads; the CLI does not auto-load that directory, so
 *   the processor lists the files from `TABNINE.md` (toon mode).
 * - Global scope: `~/.tabnine/agent/TABNINE.md` next to the other user-scoped
 *   agent assets (the CLI documents no user-level memory file, so this path
 *   mirrors the `~/.gemini/GEMINI.md` convention of the Gemini CLI it is
 *   derived from) plus `~/.tabnine/guidelines/*.md`.
 *
 * Rule files are plain Markdown without frontmatter.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings/settings-reference (`context.fileName`, `/memory`)
 * @see https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines (`.tabnine/guidelines/`)
 */
export class TabnineRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): TabnineRuleSettablePaths {
    return {
      root: {
        // The workspace file sits at the project root; the user file sits
        // inside `~/.tabnine/agent/`, which the processor reaches by supplying
        // the home directory as outputRoot.
        relativeDirPath: global ? buildToolPath(TABNINE_AGENT_DIR_PATH, ".", excludeToolDir) : ".",
        relativeFilePath: TABNINE_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(TABNINE_DIR, "guidelines", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<TabnineRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new TabnineRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    const fileContent = await readFileContent(
      join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath),
    );
    return new TabnineRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): TabnineRule {
    const paths = this.getSettablePaths({ global });
    return new TabnineRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate() {
    // Tabnine rule files are plain markdown without frontmatter requirements.
    return { success: true as const, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): TabnineRule {
    const paths = this.getSettablePaths({ global });
    // A guideline may itself be named `TABNINE.md`; only the file outside
    // the guidelines directory is the root one.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath !== paths.nonRoot.relativeDirPath;

    return new TabnineRule({
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
      toolTarget: "tabnine",
    });
  }
}
