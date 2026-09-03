import { join } from "node:path";

import { CRUSH_GLOBAL_DIR, CRUSH_RULE_FILE_NAME } from "../../constants/crush-paths.js";
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

export type CrushRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Crush reads project context from a fixed list of file names at the working
 * directory root — `CRUSH.md`, `crush.md`, `Crush.md` and their `.local`
 * variants are the Crush-specific spellings (the list also includes
 * `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and `.cursorrules`, already owned by
 * other rulesync targets). It does not scan a modular non-root instructions
 * directory, so rulesync's topic-based non-root rules have no project
 * subdirectory to map onto; their bodies are folded into the single root
 * `./CRUSH.md` by the RulesProcessor — there is no separate non-root output
 * location (`nonRoot` is `undefined`).
 *
 * In global mode, Crush reads a global context file from
 * `~/.config/crush/CRUSH.md` (it also reads `~/.config/AGENTS.md`, owned by
 * the `agentsmd` target). The same root-fold policy applies.
 *
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
 */
export type CrushRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class CrushRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: CrushRuleParams) {
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
  } = {}): CrushRuleSettablePaths {
    if (global) {
      return {
        root: {
          relativeDirPath: CRUSH_GLOBAL_DIR,
          relativeFilePath: CRUSH_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CRUSH_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    // Crush reads rules only from the root `CRUSH.md`, so the incoming
    // `relativeFilePath` is ignored and the root file is read.
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<CrushRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new CrushRule({
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
  }: ToolRuleFromRulesyncRuleParams): CrushRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    // Both root and non-root rules target the single root `./CRUSH.md`; the
    // RulesProcessor folds the non-root bodies (`root: false`) into the root
    // rule and drops the redundant non-root instances before writing.
    return new CrushRule({
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
  }: ToolRuleForDeletionParams): CrushRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === root.relativeFilePath && relativeDirPath === root.relativeDirPath;

    return new CrushRule({
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
      toolTarget: "crush",
    });
  }
}
