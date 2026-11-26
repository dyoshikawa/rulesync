import { basename, extname, join, posix } from "node:path";

import { z } from "zod/mini";

import {
  QWENCODE_DIR,
  QWENCODE_MAX_OUTPUT_STYLE_FILE_BYTES,
  QWENCODE_MAX_OUTPUT_STYLE_NAME_LENGTH,
  QWENCODE_OUTPUT_STYLES_DIR_PATH,
  QWENCODE_RESERVED_OUTPUT_STYLE_NAMES,
  QWENCODE_RULE_FILE_NAME,
} from "../../constants/qwencode-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  buildOutputStyleFrontmatter,
  getOutputStyleRuleOptionWarnings,
  isDirectMarkdownChild,
  isOutputStyleChannel,
  resolveTopLevelOutputStyleStem,
} from "./output-style-paths.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleBuildLocalRootFileParams,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
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
 * Parameters for creating a QwencodeRule from its whole file content: the root
 * memory file (`QWEN.md`), which is plain Markdown without frontmatter, or a
 * custom output style (`.qwen/output-styles/<name>.md`, `channel:
 * "output-style"`), whose frontmatter is built by the caller.
 */
type QwencodeRuleRootParams = ToolRuleParams & {
  /**
   * Marks a custom output style (opted into with `qwencode.channel:
   * output-style`) instead of a `.qwen/rules/` context rule.
   */
  channel?: "output-style";
};

/**
 * The file-name glob `getExtraFixedFiles` returns for the output-styles
 * directory, so import enumerates every style in it (never deletion — see
 * `getExtraFixedFiles`): Qwen Code loads "every `*.md` file directly inside"
 * the directory.
 */
const OUTPUT_STYLE_FILE_GLOB = "*.md";

/**
 * Whether `body` has non-whitespace text outside its HTML comments. Scans
 * left to right: each `<!--` is closed by the first `-->` after it, and an
 * unclosed `<!--` counts as text. Checks the spans in place instead of
 * building a comment-stripped string, which is never used as output.
 */
function hasTextOutsideHtmlComments(body: string): boolean {
  let position = 0;
  while (position < body.length) {
    const commentStart = body.indexOf("<!--", position);
    const textEnd = commentStart === -1 ? body.length : commentStart;
    if (body.slice(position, textEnd).trim() !== "") {
      return true;
    }
    if (commentStart === -1) {
      return false;
    }
    const commentEnd = body.indexOf("-->", commentStart + 4);
    if (commentEnd === -1) {
      // An unclosed comment is kept as text.
      return body.slice(commentStart).trim() !== "";
    }
    position = commentEnd + 3;
  }
  return false;
}

/**
 * Why Qwen Code would skip an output style with this name, body and file
 * content, or `undefined` when it would load it. Mirrors the upstream loader:
 * the name must be non-empty, at most 64 characters, free of control and
 * format characters and not `default`; the body (with HTML comments
 * stripped) must not be empty; the file must be at most 25,000 bytes.
 * @see https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/core/output-style-files.ts
 */
function findOutputStyleProblem({
  styleName,
  body,
  fileContent,
}: {
  styleName: string;
  body: string;
  fileContent: string;
}): string | undefined {
  const name = styleName.trim();
  if (name === "") {
    return "the style name is empty";
  }
  if (name.length > QWENCODE_MAX_OUTPUT_STYLE_NAME_LENGTH) {
    return `the style name is longer than ${QWENCODE_MAX_OUTPUT_STYLE_NAME_LENGTH} characters`;
  }
  if (/[\p{Cc}\p{Cf}]/u.test(name)) {
    return "the style name contains control characters";
  }
  if (QWENCODE_RESERVED_OUTPUT_STYLE_NAMES.includes(name.toLowerCase())) {
    return `the style name '${name}' is reserved for Qwen Code's built-in default style`;
  }
  if (!hasTextOutsideHtmlComments(body)) {
    return "the style has an empty body";
  }
  if (Buffer.byteLength(fileContent, "utf8") > QWENCODE_MAX_OUTPUT_STYLE_FILE_BYTES) {
    return `the style file is larger than ${QWENCODE_MAX_OUTPUT_STYLE_FILE_BYTES} bytes`;
  }
  return undefined;
}

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
 *
 * A non-root rule with `qwencode.channel: output-style` becomes a custom
 * output style instead, `.qwen/output-styles/<rule file name>.md` (project) /
 * `~/.qwen/output-styles/<rule file name>.md` (global), with the rule's
 * `description`, `qwencode.name` and `qwencode.keep-coding-instructions` as
 * the style's frontmatter. It is selected with `general.outputStyle` (the
 * `qwencode.general.outputStyle` permissions override).
 * @see https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/output-styles.md
 */
export class QwencodeRule extends ToolRule {
  /**
   * Build this tool's separate personal local-root file (`localRootMode:
   * "separate-local-file"`), for generation and import. See
   * {@link ToolRuleBuildLocalRootFileParams}.
   */
  static buildLocalRootFile({
    outputRoot,
    fileName,
    body,
    relativeDirPath,
    localRoot,
  }: ToolRuleBuildLocalRootFileParams): ToolRule {
    // Qwen Code reads the personal local file from its tool directory
    // (`.qwen/QWEN.local.md`), not the project root (project scope only).
    return new QwencodeRule({
      outputRoot,
      relativeDirPath: relativeDirPath ?? QWENCODE_DIR,
      relativeFilePath: fileName,
      fileContent: body,
      validate: true,
      root: true,
      localRoot,
    });
  }

  private readonly frontmatter: QwencodeRuleFrontmatter | undefined;
  private readonly body: string | undefined;
  private readonly channel: "output-style" | undefined;

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
      this.channel = undefined;
      return;
    }

    const { channel, ...rest } = params;
    super(rest);
    this.frontmatter = undefined;
    this.body = undefined;
    this.channel = channel;
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
    } = {},
  ): QwencodeRuleSettablePaths {
    // Global scope: the root memory file lives under `~/.qwen/QWEN.md`, and
    // path-based context rules live under `~/.qwen/rules/`.
    if (_options.global) {
      return {
        root: {
          relativeDirPath: join(QWENCODE_DIR, "."),
          relativeFilePath: QWENCODE_RULE_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: join(QWENCODE_DIR, "rules"),
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: QWENCODE_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: join(QWENCODE_DIR, "rules"),
      },
    };
  }

  /**
   * Whether the given path is a custom output style: a direct `.md` child of
   * `.qwen/output-styles/`, at either scope.
   */
  private static isOutputStylePath({
    relativeDirPath,
    relativeFilePath,
  }: {
    relativeDirPath: string | undefined;
    relativeFilePath: string;
  }): boolean {
    return isDirectMarkdownChild({
      outputStylesDirPath: QWENCODE_OUTPUT_STYLES_DIR_PATH,
      relativeDirPath,
      relativeFilePath,
    });
  }

  /** Whether a rule opts into the `output-style` channel (non-root only). */
  private static isOutputStyleRule(rulesyncRule: RulesyncRule): boolean {
    const frontmatter = rulesyncRule.getFrontmatter();
    return isOutputStyleChannel({
      root: frontmatter.root,
      channel: frontmatter.qwencode?.channel,
    });
  }

  /**
   * The output-styles directory, enumerated for import only: it also holds
   * styles users write by hand (including their personal
   * `~/.qwen/output-styles/`) that rulesync cannot tell from its own, so
   * `--delete` leaves it alone and it is not gitignored. Same at both scopes.
   */
  static getExtraFixedFiles(): ToolRuleExtraFixedFile[] {
    return [
      {
        relativeDirPath: QWENCODE_OUTPUT_STYLES_DIR_PATH,
        relativeFilePath: OUTPUT_STYLE_FILE_GLOB,
        importOnly: true,
      },
    ];
  }

  /**
   * See {@link getOutputStyleRuleOptionWarnings}; also flags
   * `qwencode.keep-coding-instructions`, which, like `qwencode.name`, is read
   * only with `channel: output-style`.
   */
  static getRuleOptionWarnings(rules: RulesyncRule[]): string[] {
    const warnings = getOutputStyleRuleOptionWarnings({
      rules,
      sectionKey: "qwencode",
      isTargetedByRulesyncRule: (rule) => this.isTargetedByRulesyncRule(rule),
    });
    for (const rule of rules) {
      const frontmatter = rule.getFrontmatter();
      const section = frontmatter.qwencode;
      if (
        frontmatter.root ||
        !section ||
        section.channel === "output-style" ||
        section["keep-coding-instructions"] === undefined ||
        !this.isTargetedByRulesyncRule(rule)
      ) {
        continue;
      }
      warnings.push(
        `${stripControlCharacters(rule.getRelativeFilePath())} sets qwencode.keep-coding-instructions, which is read only with qwencode.channel: output-style; ignoring it.`,
      );
    }
    return warnings;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<QwencodeRule> {
    const paths = this.getSettablePaths({ global });

    if (this.isOutputStylePath({ relativeDirPath, relativeFilePath })) {
      const fileContent = await readFileContent(
        join(outputRoot, QWENCODE_OUTPUT_STYLES_DIR_PATH, relativeFilePath),
      );
      return new QwencodeRule({
        outputRoot,
        relativeDirPath: QWENCODE_OUTPUT_STYLES_DIR_PATH,
        relativeFilePath,
        fileContent,
        validate,
        root: false,
        channel: "output-style",
      });
    }
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

    if (this.isOutputStyleRule(rulesyncRule)) {
      return this.buildOutputStyle({ outputRoot, rulesyncRule, validate });
    }

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

  /**
   * Write an `output-style` rule as `.qwen/output-styles/<name>.md`. The file
   * name is the rule's own, so a rule nested under `.rulesync/rules/` is
   * refused (Qwen Code reads only the files directly in `output-styles/`), as
   * are styles Qwen Code would skip: one named `default` (reserved for the
   * built-in style), one with an empty body, and one larger than 25 kB.
   */
  private static buildOutputStyle({
    outputRoot,
    rulesyncRule,
    validate,
  }: {
    outputRoot: string;
    rulesyncRule: RulesyncRule;
    validate: boolean;
  }): QwencodeRule {
    const frontmatter = rulesyncRule.getFrontmatter();
    const sourcePath = rulesyncRule.getRelativeFilePath();
    const stem = resolveTopLevelOutputStyleStem({
      sourcePath,
      message: `Rule '${sourcePath}' sets qwencode.channel: output-style but is nested in a subdirectory: Qwen Code reads only the files directly in .qwen/output-styles/, so move it to the top of ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
    });
    const name = frontmatter.qwencode?.name;
    const body = rulesyncRule.getBody();

    const keepCodingInstructions = frontmatter.qwencode?.["keep-coding-instructions"];
    const styleFrontmatter = {
      ...buildOutputStyleFrontmatter({ name, description: frontmatter.description }),
      ...(keepCodingInstructions !== undefined && {
        "keep-coding-instructions": keepCodingInstructions,
      }),
    };
    const fileContent =
      Object.keys(styleFrontmatter).length > 0
        ? stringifyFrontmatter(body, styleFrontmatter)
        : body;
    const problem = findOutputStyleProblem({ styleName: name ?? stem, body, fileContent });
    if (problem !== undefined) {
      throw new Error(
        `Rule '${sourcePath}' sets qwencode.channel: output-style, but ${problem}, so Qwen Code would skip it. Rename the rule file, set qwencode.name or fix the body.`,
      );
    }
    return new QwencodeRule({
      outputRoot,
      relativeDirPath: QWENCODE_OUTPUT_STYLES_DIR_PATH,
      relativeFilePath: `${stem}.md`,
      fileContent,
      validate,
      root: false,
      channel: "output-style",
    });
  }

  /**
   * An output style Qwen Code would skip (see {@link findOutputStyleProblem})
   * is skipped on import too: the directory holds hand-written styles, and
   * one such file must not fail the whole import or come back as a rule
   * generate refuses.
   */
  override getImportSkipReason(): string | undefined {
    if (this.channel !== "output-style") {
      return undefined;
    }
    let frontmatter: Record<string, unknown>;
    let body: string;
    try {
      ({ frontmatter, body } = parseFrontmatter(
        this.getFileContent(),
        join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      ));
    } catch (error) {
      return `its frontmatter cannot be parsed (${formatError(error)})`;
    }
    const styleName =
      typeof frontmatter.name === "string"
        ? frontmatter.name
        : basename(this.getRelativeFilePath(), extname(this.getRelativeFilePath()));
    const problem = findOutputStyleProblem({
      styleName,
      body,
      fileContent: this.getFileContent(),
    });
    return problem === undefined ? undefined : `${problem}, so Qwen Code skips it.`;
  }

  toRulesyncRule(): RulesyncRule {
    if (this.channel === "output-style") {
      // The style's `name` / `description` / `keep-coding-instructions`
      // frontmatter maps back onto the rule's `qwencode.name` / `description`
      // / `qwencode.keep-coding-instructions`, and the file keeps its own
      // name, so generate writes it back to the same path.
      const { frontmatter, body } = parseFrontmatter(
        this.getFileContent(),
        join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      );
      const name =
        typeof frontmatter.name === "string" && frontmatter.name.trim() !== ""
          ? frontmatter.name
          : undefined;
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description : undefined;
      const keepCodingInstructions =
        typeof frontmatter["keep-coding-instructions"] === "boolean"
          ? frontmatter["keep-coding-instructions"]
          : undefined;
      return new RulesyncRule({
        outputRoot: process.cwd(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: this.getRelativeFilePath(),
        frontmatter: {
          root: false,
          targets: ["qwencode"],
          ...(description !== undefined && { description }),
          qwencode: {
            channel: "output-style",
            ...(name !== undefined && { name }),
            ...(keepCodingInstructions !== undefined && {
              "keep-coding-instructions": keepCodingInstructions,
            }),
          },
        },
        body: body.trim(),
      });
    }
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
    if (this.isOutputStylePath({ relativeDirPath, relativeFilePath })) {
      return new QwencodeRule({
        outputRoot,
        relativeDirPath,
        relativeFilePath,
        fileContent: "",
        validate: false,
        root: false,
        channel: "output-style",
      });
    }

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

  protected static override readonly toolTarget = "qwencode";

  /**
   * The personal local context file lives under `.qwen/`, not at the project
   * root where the settable root path points, so override the deletion glob.
   */
  static getLocalRootFileGlob({ fileName }: { fileName: string }): string {
    return posix.join(toPosixPath(QWENCODE_DIR), fileName);
  }
}
