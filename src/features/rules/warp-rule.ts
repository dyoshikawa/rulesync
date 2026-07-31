import { join } from "node:path";

import { WARP_GLOBAL_RULE_DIR, WARP_RULE_FILE_NAME } from "../../constants/warp-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type WarpRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Warp reads project rules only from `AGENTS.md` (or the back-compat `WARP.md`)
 * at the repository root and in subdirectories that match the project tree — it
 * does NOT scan a `.warp/memories/` directory and does not follow references out
 * of a rules file. rulesync's topic-based non-root rules have no project
 * subdirectory to map onto, so their bodies are folded into the single root
 * `./AGENTS.md` by the RulesProcessor; there is no separate non-root output
 * location (`nonRoot` is `undefined`).
 *
 * In global mode, Warp reads a third rule source from `~/.agents/AGENTS.md`
 * (the cross-tool agent config directory), indexed like project rules and also
 * used from remote hosts in SSH sessions. The same root-fold policy applies.
 *
 * @see https://docs.warp.dev/agent-platform/capabilities/rules/
 * @see https://docs.warp.dev/terminal/settings/file-locations/
 */
export type WarpRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class WarpRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: WarpRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): WarpRuleSettablePaths {
    if (global) {
      return {
        root: {
          relativeDirPath: WARP_GLOBAL_RULE_DIR,
          relativeFilePath: WARP_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: WARP_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    // Warp reads rules only from the root `AGENTS.md`, so the incoming
    // `relativeFilePath` is ignored and the root file is read.
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<WarpRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new WarpRule({
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
  }: ToolRuleFromRulesyncRuleParams): WarpRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    // Both root and non-root rules target the single root `./AGENTS.md`; the
    // RulesProcessor folds the non-root bodies (`root: false`) into the root rule
    // and drops the redundant non-root instances before writing.
    return new WarpRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): WarpRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === root.relativeFilePath && relativeDirPath === root.relativeDirPath;

    return new WarpRule({
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
      toolTarget: "warp",
    });
  }
}
