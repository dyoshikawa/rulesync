import { join } from "node:path";

import {
  ROVODEV_DIR,
  ROVODEV_LEGACY_RULE_FILE_NAME,
  ROVODEV_MODULAR_RULES_DIR_PATH,
  ROVODEV_RULE_FILE_NAME,
} from "../../constants/rovodev-paths.js";
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

/** Basenames reserved for project memory; not modular rules under `.rovodev/.rulesync/modular-rules/`. Lower-cased for case-insensitive comparison (macOS/Windows). */
const DISALLOWED_ROVODEV_MODULAR_RULE_BASENAMES = new Set(["agents.md", "agents.local.md"]);

/** Project paths; `nonRoot` is modular rules under `.rovodev/.rulesync/modular-rules/`. */
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
 * Non-root modular rules live under `.rovodev/.rulesync/modular-rules/` (import via `loadToolFiles`, generate via `fromRulesyncRule` in project mode only).
 *
 * @see https://developer.atlassian.com/platform/rovodev-cli/
 */
export class RovodevRule extends ToolRule {
  /**
   * Whether `relativePath` (posix-style path relative to modular-rules root) may be imported as a modular rule.
   * Rejects memory filenames that belong at repo root or under `.rovodev/AGENTS.md`.
   */
  static isAllowedModularRulesRelativePath(relativePath: string): boolean {
    if (!relativePath) {
      return false;
    }
    for (const segment of relativePath.split(/[/\\]/)) {
      if (segment === "" || segment === "." || segment === "..") {
        continue;
      }
      if (DISALLOWED_ROVODEV_MODULAR_RULE_BASENAMES.has(segment.toLowerCase())) {
        return false;
      }
    }
    return true;
  }

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
      relativeDirPath: ROVODEV_DIR,
      relativeFilePath: ROVODEV_RULE_FILE_NAME,
    };
    if (global) {
      return {
        root: rovodevAgents,
      };
    }
    return {
      root: rovodevAgents,
      alternativeRoots: [{ relativeDirPath: ".", relativeFilePath: ROVODEV_RULE_FILE_NAME }],
      nonRoot: {
        relativeDirPath: ROVODEV_MODULAR_RULES_DIR_PATH,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<RovodevRule> {
    const paths = this.getSettablePaths({ global });

    if (
      !global &&
      "nonRoot" in paths &&
      paths.nonRoot &&
      overrideDirPath === paths.nonRoot.relativeDirPath
    ) {
      return this.fromModularFile({
        outputRoot,
        relativeFilePath,
        relativeDirPath: overrideDirPath,
        validate,
        global,
      });
    }

    return this.fromRootFile({
      outputRoot,
      relativeFilePath,
      overrideDirPath,
      validate,
      global,
      paths,
    });
  }

  private static async fromModularFile({
    outputRoot,
    relativeFilePath,
    relativeDirPath,
    validate,
    global,
  }: {
    outputRoot: string;
    relativeFilePath: string;
    relativeDirPath: string;
    validate: boolean;
    global: boolean;
  }): Promise<RovodevRule> {
    if (!this.isAllowedModularRulesRelativePath(relativeFilePath)) {
      throw new Error(
        `Reserved Rovodev memory basename under modular-rules (not a modular rule): ${join(relativeDirPath, relativeFilePath)}`,
      );
    }
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));
    return new RovodevRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      global,
      root: false,
    });
  }

  private static async fromRootFile({
    outputRoot,
    relativeFilePath,
    overrideDirPath,
    validate,
    global,
    paths,
  }: {
    outputRoot: string;
    relativeFilePath: string;
    overrideDirPath: string | undefined;
    validate: boolean;
    global: boolean;
    paths: RovodevRuleSettablePaths | ToolRuleSettablePathsGlobal;
  }): Promise<RovodevRule> {
    const relativeDirPath = overrideDirPath ?? paths.root.relativeDirPath;

    const agentsMdExpectedLocationsDescription =
      "alternativeRoots" in paths && paths.alternativeRoots && paths.alternativeRoots.length > 0
        ? `${join(paths.root.relativeDirPath, paths.root.relativeFilePath)} or project root`
        : join(paths.root.relativeDirPath, paths.root.relativeFilePath);

    if (relativeFilePath !== ROVODEV_RULE_FILE_NAME) {
      throw new Error(
        `Rovodev rules support only AGENTS.md at ${agentsMdExpectedLocationsDescription}, got: ${join(relativeDirPath, relativeFilePath)}`,
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
        `Rovodev AGENTS.md must be at ${agentsMdExpectedLocationsDescription}, got: ${join(relativeDirPath, relativeFilePath)}`,
      );
    }

    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new RovodevRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      global,
      root: true,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): RovodevRule {
    return new RovodevRule({
      outputRoot,
      relativeDirPath: relativeDirPath ?? ".",
      relativeFilePath: relativeFilePath ?? ROVODEV_RULE_FILE_NAME,
      fileContent: "",
      validate: false,
      global,
      root: relativeFilePath === ROVODEV_RULE_FILE_NAME,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): RovodevRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    if (isRoot) {
      return new RovodevRule(
        this.buildToolRuleParamsDefault({
          outputRoot,
          rulesyncRule,
          validate,
          global,
          rootPath: paths.root,
          nonRootPath: undefined,
        }),
      );
    }

    if (global || !("nonRoot" in paths) || !paths.nonRoot) {
      throw new Error(
        "Rovodev non-root (modular) rules are only supported in project mode with .rovodev/.rulesync/modular-rules.",
      );
    }

    const modularRelativePath = rulesyncRule.getRelativeFilePath();
    if (!this.isAllowedModularRulesRelativePath(modularRelativePath)) {
      throw new Error(
        `Reserved Rovodev memory basename in modular rule path: ${modularRelativePath}`,
      );
    }

    return new RovodevRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        global,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    if (this.getRelativeFilePath() === ROVODEV_LEGACY_RULE_FILE_NAME) {
      return new RulesyncRule({
        outputRoot: this.getOutputRoot(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: ROVODEV_LEGACY_RULE_FILE_NAME,
        frontmatter: {
          targets: ["rovodev"],
          root: false,
          localRoot: true,
          globs: [],
        },
        body: this.getFileContent(),
        validate: true,
      });
    }

    if (!this.isRoot()) {
      return new RulesyncRule({
        outputRoot: this.getOutputRoot(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: this.getRelativeFilePath(),
        frontmatter: {
          targets: ["rovodev"],
          root: false,
          globs: this.globs ?? [],
          ...(this.description !== undefined ? { description: this.description } : {}),
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
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "rovodev",
    });
  }

  /**
   * Mirror the primary `.rovodev/AGENTS.md` root rule to `./AGENTS.md` so project
   * memory stays discoverable at the repo root. Empty when `rootRule` is not the primary root.
   */
  static getRootMirrorFiles({
    outputRoot,
    rootRule,
    content,
  }: {
    outputRoot: string;
    rootRule: ToolRule;
    content: string;
  }): RovodevRule[] {
    if (!(rootRule instanceof RovodevRule)) {
      return [];
    }
    const primary = this.getSettablePaths({ global: false }).root;
    if (
      rootRule.getRelativeDirPath() !== primary.relativeDirPath ||
      rootRule.getRelativeFilePath() !== primary.relativeFilePath
    ) {
      return [];
    }
    return [
      new RovodevRule({
        outputRoot,
        relativeDirPath: ".",
        relativeFilePath: ROVODEV_RULE_FILE_NAME,
        fileContent: content,
        validate: true,
        root: true,
      }),
    ];
  }

  /**
   * Globs for mirror deletion: the `./AGENTS.md` mirror (`mirrorGlob`) is deleted
   * only when the primary `.rovodev/AGENTS.md` (`primaryGlob`) still exists.
   */
  static getRootMirrorDeletionGlobs({ outputRoot }: { outputRoot: string }): {
    primaryGlob: string;
    mirrorGlob: string;
  } {
    return {
      primaryGlob: join(outputRoot, ROVODEV_DIR, ROVODEV_RULE_FILE_NAME),
      mirrorGlob: join(outputRoot, ROVODEV_RULE_FILE_NAME),
    };
  }

  /** Glob for the `separate-local-file` deletion; rovodev writes it at project root, not under `.rovodev/`. */
  static getLocalRootDeletionGlob({
    outputRoot,
    fileName,
  }: {
    outputRoot: string;
    fileName: string;
  }): string {
    return join(outputRoot, fileName);
  }
}
