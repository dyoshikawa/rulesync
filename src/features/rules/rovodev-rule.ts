import { join } from "node:path";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

export type RovodevRuleParams = AiFileParams & {
  root?: boolean;
};

/** Project paths; `nonRoot` is a stable subdirectory for `ToolRule` typing (no rulesync non-root rules yet). */
export type RovodevRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  alternativeRoots: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
};

/**
 * Rovodev CLI memory: project `.rovodev/AGENTS.md` (canonical rulesync output), mirrored `./AGENTS.md`
 * for [Rovo Dev project memory](https://support.atlassian.com/rovo/docs/use-memory-in-rovo-dev-cli/),
 * and user `~/.rovodev/AGENTS.md` in global mode. `localRoot` rulesync maps to `./AGENTS.local.md`.
 *
 * @see https://developer.atlassian.com/platform/rovodev-cli/
 */
export class RovodevRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: RovodevRuleParams) {
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
  } = {}): RovodevRuleSettablePaths | ToolRuleSettablePathsGlobal {
    const rovodevAgents = {
      relativeDirPath: ".rovodev",
      relativeFilePath: "AGENTS.md",
    };
    if (global) {
      return {
        root: rovodevAgents,
      };
    }
    return {
      root: rovodevAgents,
      alternativeRoots: [{ relativeDirPath: ".", relativeFilePath: "AGENTS.md" }],
      nonRoot: {
        relativeDirPath: join(".rovodev", ".rulesync", "modular-rules"),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<RovodevRule> {
    const paths = this.getSettablePaths({ global });
    const relativeDirPath = overrideDirPath ?? paths.root.relativeDirPath;

    if (relativeFilePath !== "AGENTS.md") {
      throw new Error(
        `Rovodev rules support only AGENTS.md under .rovodev/ or project root, got: ${join(relativeDirPath, relativeFilePath)}`,
      );
    }

    const allowed =
      relativeDirPath === paths.root.relativeDirPath ||
      ("alternativeRoots" in paths &&
        paths.alternativeRoots?.some(
          (alt) =>
            alt.relativeDirPath === relativeDirPath && alt.relativeFilePath === relativeFilePath,
        ));

    if (!allowed) {
      throw new Error(
        `Rovodev AGENTS.md must be at ${join(paths.root.relativeDirPath, paths.root.relativeFilePath)} or project root, got: ${join(relativeDirPath, relativeFilePath)}`,
      );
    }

    const fileContent = await readFileContent(join(baseDir, relativeDirPath, relativeFilePath));

    return new RovodevRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      global,
      root: true,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): RovodevRule {
    return new RovodevRule({
      baseDir,
      relativeDirPath: relativeDirPath ?? ".",
      relativeFilePath: relativeFilePath ?? "AGENTS.md",
      fileContent: "",
      validate: false,
      global,
      root: relativeFilePath === "AGENTS.md",
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): RovodevRule {
    if (!rulesyncRule.getFrontmatter().root) {
      throw new Error(
        "Rovodev supports only the root rule for AGENTS.md; non-root rules are not supported.",
      );
    }
    const rootPath = this.getSettablePaths({ global }).root;
    return new RovodevRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        global,
        rootPath,
        nonRootPath: undefined,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    if (this.getRelativeFilePath() === "AGENTS.local.md") {
      return new RulesyncRule({
        baseDir: this.getBaseDir(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "AGENTS.local.md",
        frontmatter: {
          targets: ["*"],
          root: false,
          localRoot: true,
          globs: [],
        },
        body: this.getFileContent(),
        validate: true,
      });
    }

    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    const fm = rulesyncRule.getFrontmatter();
    const isRoot = fm.root ?? false;
    const isLocalRoot = fm.localRoot ?? false;
    if (!isRoot && !isLocalRoot) {
      return false;
    }

    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "rovodev",
    });
  }
}
