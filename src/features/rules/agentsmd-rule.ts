import { join } from "node:path";

import {
  AGENTSMD_DIR,
  AGENTSMD_MEMORIES_DIR_PATH,
  AGENTSMD_RULE_FILE_NAME,
} from "../../constants/agentsmd-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type AgentsMdRuleParams = AiFileParams & {
  root?: boolean;
};

export type AgentsMdRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Directories never scanned for nested `AGENTS.md` files. Hidden directories are
 * excluded because an `AGENTS.md` inside one is another tool's generated output
 * (rulesync writes several itself), not a subproject. The rest are dependency,
 * vendoring and build trees: an `AGENTS.md` there describes somebody else's
 * project, and is usually gitignored, so importing it would move content the
 * user deliberately kept out of the repository into version-controlled
 * `.rulesync/rules/`.
 */
const NESTED_SCAN_EXCLUDED_DIRS = [
  "node_modules",
  "vendor",
  "third_party",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "tmp",
  "temp",
  "venv",
  "__pycache__",
];

export class AgentsMdRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: AgentsMdRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AgentsMdRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(AGENTSMD_DIR, "memories", _options.excludeToolDir),
      },
    };
  }

  /**
   * Patterns for the nested `AGENTS.md` files that are the standard's only scoping
   * mechanism — "Agents automatically read the nearest file in the directory
   * tree, so the closest one takes precedence and every subproject can ship
   * tailored instructions." The project root file is excluded because it is
   * enumerated separately as the root rule.
   *
   * Import-only. The matches are hand-authored files anywhere in the tree rather
   * than files under a rulesync-owned directory, so enumerating them for
   * `--delete` would sweep away work rulesync never wrote.
   *
   * @see https://agents.md/
   */
  static getNestedFilePatterns({ outputRoot }: { outputRoot: string }): ToolRuleNestedFilePatterns {
    const root = toPosixPath(outputRoot);
    return {
      include: [`${root}/**/${AGENTSMD_RULE_FILE_NAME}`],
      ignore: [
        // Enumerated separately as the root rule.
        `${root}/${AGENTSMD_RULE_FILE_NAME}`,
        `${root}/**/.*/**`,
        ...NESTED_SCAN_EXCLUDED_DIRS.map((dir) => `${root}/**/${dir}/**`),
      ],
    };
  }

  /**
   * The subproject directory this rule scopes, or `undefined` for the project
   * root file and for the modular `.agents/memories/` files.
   */
  getSubprojectPath(): string | undefined {
    if (this.isRoot() || this.getRelativeFilePath() !== AGENTSMD_RULE_FILE_NAME) {
      return undefined;
    }
    const relativeDirPath = toPosixPath(this.getRelativeDirPath());
    if (relativeDirPath === "." || relativeDirPath === "" || relativeDirPath.startsWith(".")) {
      return undefined;
    }
    return relativeDirPath;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AgentsMdRule> {
    // A nested subproject file is an `AGENTS.md` somewhere other than the project
    // root and outside the tool's own `.agents/` tree.
    const normalizedDirPath = relativeDirPath === undefined ? "." : toPosixPath(relativeDirPath);
    const isNested =
      relativeFilePath === AGENTSMD_RULE_FILE_NAME &&
      normalizedDirPath !== "." &&
      normalizedDirPath !== "" &&
      !normalizedDirPath.startsWith(".");
    // Only the file at the project root is the root rule. A modular file that
    // happens to be named `AGENTS.md` under `.agents/memories/` is not.
    const isRoot =
      !isNested &&
      relativeFilePath === AGENTSMD_RULE_FILE_NAME &&
      (normalizedDirPath === "." || normalizedDirPath === "");
    const relativePath = isNested
      ? join(normalizedDirPath, relativeFilePath)
      : isRoot
        ? AGENTSMD_RULE_FILE_NAME
        : join(AGENTSMD_MEMORIES_DIR_PATH, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new AgentsMdRule({
      outputRoot,
      relativeDirPath: isNested
        ? normalizedDirPath
        : isRoot
          ? this.getSettablePaths().root.relativeDirPath
          : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? AGENTSMD_RULE_FILE_NAME : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AgentsMdRule {
    const isRoot = relativeFilePath === AGENTSMD_RULE_FILE_NAME && relativeDirPath === ".";

    return new AgentsMdRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AgentsMdRule {
    return new AgentsMdRule(
      this.buildToolRuleParamsAgentsmd({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    const subprojectPath = this.getSubprojectPath();
    if (subprojectPath === undefined) {
      return this.toRulesyncRuleDefault();
    }

    // Every nested file is named `AGENTS.md`, so the rulesync file is named after
    // the directory it scopes; `subprojectPath` sends it back to the same place
    // on the next generate.
    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: `${subprojectPath.replaceAll("/", "-")}.md`,
      frontmatter: {
        root: false,
        targets: ["*"],
        description: this.getDescription(),
        globs: [`${subprojectPath}/**/*`],
        agentsmd: { subprojectPath },
      },
      body: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    // AGENTS.md rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "agentsmd",
    });
  }
}
