import { join } from "node:path";

import { z } from "zod/mini";

import { QWENCODE_DIR, QWENCODE_RULE_FILE_NAME } from "../../constants/qwencode-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Frontmatter schema for Qwen Code path-based context rules (`.qwen/rules/*.md`).
 *
 * Qwen Code (v0.15.0+) injects rules from `.qwen/rules/` based on their YAML
 * frontmatter:
 * - `paths`: glob array (picomatch). When present, the rule is *conditional* and
 *   is lazily injected when the model touches a matching file.
 * - `description`: human-readable summary surfaced to the model.
 * Rules without `paths` are *baseline* rules loaded at session start.
 *
 * Uses `z.looseObject()` so forward-compatible fields added upstream are
 * preserved on round-trip.
 */
const QwencodeRuleFrontmatterSchema = z.looseObject({
  paths: z.optional(z.union([z.array(z.string()), z.string()])),
  description: z.optional(z.string()),
});

export type QwencodeRuleFrontmatter = z.infer<typeof QwencodeRuleFrontmatterSchema>;

/**
 * Parameters for creating a non-root QwencodeRule (`.qwen/rules/*.md`).
 * These rules carry YAML frontmatter, so the body and frontmatter are passed
 * separately instead of a combined `fileContent`.
 */
type QwencodeRuleNonRootParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: QwencodeRuleFrontmatter;
  body: string;
};

/**
 * Parameters for creating a root QwencodeRule (`QWEN.md`).
 * The root memory file is plain Markdown without frontmatter, so `fileContent`
 * is passed directly (mirroring the original behavior).
 */
type QwencodeRuleRootParams = ToolRuleParams;

export type QwencodeRuleParams = QwencodeRuleNonRootParams | QwencodeRuleRootParams;

export type QwencodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

function isNonRootParams(params: QwencodeRuleParams): params is QwencodeRuleNonRootParams {
  return "frontmatter" in params && "body" in params;
}

/**
 * Converts a `paths` frontmatter value (array or comma-tolerant string) into a
 * normalized string array. Returns an empty array when unset.
 */
function normalizePaths(paths: string[] | string | undefined): string[] {
  if (!paths) {
    return [];
  }
  if (Array.isArray(paths)) {
    return paths.filter((p) => p.trim().length > 0);
  }
  if (paths.trim() === "") {
    return [];
  }
  return [paths.trim()];
}

/**
 * Rule generator for Qwen Code AI assistant.
 *
 * - Root rules are emitted to `QWEN.md` (project) / `~/.qwen/QWEN.md` (global) as
 *   plain Markdown memory files (unchanged behavior).
 * - Non-root rules are emitted to `.qwen/rules/` (project) / `~/.qwen/rules/`
 *   (global) as Markdown files with YAML frontmatter. Rulesync `globs` map to
 *   the upstream `paths` field (conditional, path-based injection) and rulesync
 *   `description` maps to `description`. Rules without globs become baseline
 *   rules (no `paths`).
 *
 * `.qwen/rules/` supersedes the legacy `.qwen/memories/` directory as the
 * non-root surface; each rule is emitted to exactly one location.
 */
export class QwencodeRule extends ToolRule {
  private readonly frontmatter: QwencodeRuleFrontmatter | undefined;
  private readonly body: string | undefined;

  constructor(params: QwencodeRuleParams) {
    if (isNonRootParams(params)) {
      const { frontmatter, body, ...rest } = params;
      if (rest.validate !== false) {
        const result = QwencodeRuleFrontmatterSchema.safeParse(frontmatter);
        if (!result.success) {
          throw new Error(
            `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
          );
        }
      }

      super({
        ...rest,
        fileContent: QwencodeRule.buildNonRootFileContent({ body, frontmatter }),
      });
      this.frontmatter = frontmatter;
      this.body = body;
      return;
    }

    super(params);
    this.frontmatter = undefined;
    this.body = undefined;
  }

  /**
   * Builds the file content for a non-root rule. When the frontmatter is empty
   * (no `paths`/`description`), the body is emitted as plain Markdown without a
   * frontmatter block to keep baseline rules clean.
   */
  private static buildNonRootFileContent({
    body,
    frontmatter,
  }: {
    body: string;
    frontmatter: QwencodeRuleFrontmatter;
  }): string {
    const hasFrontmatter = Object.values(frontmatter).some((value) =>
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "",
    );
    if (!hasFrontmatter) {
      return body;
    }
    return stringifyFrontmatter(body, frontmatter);
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): QwencodeRuleSettablePaths {
    // Global scope: the root memory file lives under `~/.qwen/QWEN.md`, and
    // path-based context rules live under `~/.qwen/rules/`.
    if (_options.global) {
      return {
        root: {
          relativeDirPath: buildToolPath(QWENCODE_DIR, ".", _options.excludeToolDir),
          relativeFilePath: QWENCODE_RULE_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: buildToolPath(QWENCODE_DIR, "rules", _options.excludeToolDir),
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: QWENCODE_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(QWENCODE_DIR, "rules", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<QwencodeRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === QWENCODE_RULE_FILE_NAME;

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, QWENCODE_RULE_FILE_NAME),
      );
      return new QwencodeRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: QWENCODE_RULE_FILE_NAME,
        fileContent,
        validate,
        root: true,
      });
    }

    const filePath = join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    let parsedFrontmatter: QwencodeRuleFrontmatter;
    if (validate) {
      const result = QwencodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
      parsedFrontmatter = result.data;
    } else {
      parsedFrontmatter = frontmatter as QwencodeRuleFrontmatter;
    }

    return new QwencodeRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: parsedFrontmatter,
      body: body.trim(),
      validate,
      root: false,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { outputRoot = process.cwd(), rulesyncRule, validate = true, global = false } = params;
    const paths = this.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const isRoot = rulesyncFrontmatter.root ?? false;

    if (isRoot) {
      return new QwencodeRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: true,
      });
    }

    // Map rulesync `globs` -> upstream `paths`. A glob of `**/*` (or `*`) means
    // "always", so it is treated as a baseline rule (no `paths`). Specific globs
    // become conditional `paths`.
    const globs = normalizePaths(rulesyncFrontmatter.globs);
    // `every()` returns true for an empty array, so empty globs are universal too.
    const isUniversal = globs.every((glob) => glob === "**/*" || glob === "*");
    const frontmatter: QwencodeRuleFrontmatter = {
      paths: isUniversal ? undefined : globs,
      // Omit empty descriptions so they do not leave a bare `description: ''`
      // line in the emitted frontmatter.
      description: rulesyncFrontmatter.description || undefined,
    };

    return new QwencodeRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.isRoot()) {
      return this.toRulesyncRuleDefault();
    }

    const globs = normalizePaths(this.frontmatter?.paths);

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        description: this.frontmatter?.description,
        globs,
      },
      body: this.body ?? this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = QwencodeRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: new Error(formatError(result.error)) };
    }
    return { success: true, error: null };
  }

  getFrontmatter(): QwencodeRuleFrontmatter | undefined {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body ?? this.getFileContent();
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): QwencodeRule {
    const isRoot = relativeFilePath === QWENCODE_RULE_FILE_NAME && relativeDirPath === ".";

    if (isRoot) {
      return new QwencodeRule({
        outputRoot,
        relativeDirPath,
        relativeFilePath,
        fileContent: "",
        validate: false,
        root: true,
      });
    }

    return new QwencodeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "qwencode",
    });
  }
}
