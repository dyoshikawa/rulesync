import { basename, join } from "node:path";

import { z } from "zod/mini";

import { JUNIE_AGENTS_DIR_PATH, JUNIE_ALT_AGENTS_DIR_PATH } from "../../constants/junie-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { firstNonHeadingParagraph } from "../../utils/markdown-paragraph.js";
import { truncateText } from "../../utils/truncate.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  parseGeneratedSubagentFrontmatter,
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Frontmatter for Junie CLI custom subagents (`.junie/agents/*.md`, plus one
 * subdirectory level). Junie
 * documents these fields; the schema stays loose (and the list fields accept a
 * single string or an array) for forward compatibility.
 *
 * @see https://junie.jetbrains.com/docs/junie-cli-subagents.html
 */
export const JunieSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  // Optional upstream: when it is missing (or the file has no frontmatter),
  // Junie uses the first non-heading paragraph of the body, truncated to
  // 1,024 characters. Import applies the same fallback (see `fromFile`).
  description: z.optional(z.string()),
  // Tool access controls.
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  disallowedTools: z.optional(z.union([z.string(), z.array(z.string())])),
  // MCP servers the subagent may use.
  mcpServers: z.optional(z.union([z.string(), z.array(z.string())])),
  // Run controls, in upstream's documented order. The enum-shaped fields are
  // kept as plain strings so an upstream addition round-trips instead of
  // failing: `permissionMode` is `default` | `acceptEdits` | `dontAsk` |
  // `bypassPermissions` | `plan` (defaulting to `default`), and
  // `reasoningLevel` is low | medium | high.
  model: z.optional(z.string()),
  permissionMode: z.optional(z.string()),
  reasoningLevel: z.optional(z.string()),
  maxTurns: z.optional(z.number()),
  // Agent Skills the subagent should utilize.
  skills: z.optional(z.union([z.string(), z.array(z.string())])),
  // Whether the subagent accepts a prompt argument.
  allowPromptArgument: z.optional(z.boolean()),
});

export type JunieSubagentFrontmatter = z.infer<typeof JunieSubagentFrontmatterSchema>;

/** Junie truncates a body-derived subagent description to this many characters. */
const JUNIE_DERIVED_DESCRIPTION_MAX_LENGTH = 1024;

/**
 * Junie's fallback when a subagent's frontmatter has no `description`: the
 * first non-heading paragraph of the body, truncated to 1,024 characters.
 * Returns `undefined` when the body has no such paragraph.
 *
 * @see https://junie.jetbrains.com/docs/junie-cli-subagents.html
 */
function deriveDescriptionFromBody(body: string): string | undefined {
  const paragraph = firstNonHeadingParagraph(body);
  if (paragraph === "") return undefined;
  return truncateText({
    text: paragraph,
    maxLength: JUNIE_DERIVED_DESCRIPTION_MAX_LENGTH,
    suffix: "",
  });
}

function isMissingDescription(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Junie's fallback subagent name: the file name without its `.agent.md` or
 * `.md` extension. A file in a subdirectory (`review/security.md`) is named
 * after the file alone (`security`); Junie documents no directory prefix.
 */
function nameFromFileName(relativeFilePath: string): string {
  return basename(relativeFilePath).replace(/(\.agent)?\.md$/, "");
}

/**
 * Normalizes a subagent name the way Junie does: the result is what Junie
 * accepts for `--agent` and must match `[a-z0-9][a-z0-9_-]*`.
 *
 * - Surrounding whitespace is trimmed first, so a quoted `"  Code Reviewer "`
 *   (or a file named ` Reviewer.md`) does not start or end with a hyphen,
 *   which the leading-character rule would reject.
 * - Uppercase letters are lowercased.
 * - Each run of whitespace (spaces, tabs, ...) becomes a single hyphen. The
 *   upstream docs only say Junie "replaces spaces with hyphens"; collapsing
 *   runs gives `code-reviewer` for `Code  Reviewer`, which is the name a user
 *   would expect and still matches the pattern, instead of `code--reviewer`.
 *
 * @see https://junie.jetbrains.com/docs/junie-cli-subagents.html
 */
export function normalizeJunieName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export type JunieSubagentParams = {
  frontmatter: JunieSubagentFrontmatter;
  body: string;
} & AiFileParams;

export class JunieSubagent extends ToolSubagent {
  private readonly frontmatter: JunieSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: JunieSubagentParams) {
    if (rest.validate !== false) {
      const result = JunieSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Junie subagents use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.junie/agents/
    // - Global mode: {getHomeDirectory()}/.junie/agents/
    //
    // Junie additionally discovers subagents from the cross-tool `.agents/`
    // directory (project `.agents/` and user `~/.agents/`). That is an
    // import-only root: generation still writes to `.junie/agents/`.
    return {
      relativeDirPath: JUNIE_AGENTS_DIR_PATH,
      importDirPaths: [JUNIE_ALT_AGENTS_DIR_PATH],
    };
  }

  getFrontmatter(): JunieSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  /**
   * The name Junie resolves after normalization, so `Code Reviewer.md` and
   * `code-reviewer.md` (both `code-reviewer`) are reported as duplicates on
   * import instead of becoming two rulesync subagents with the same name.
   */
  override getImportIdentity(): string {
    return this.getNormalizedName();
  }

  /**
   * An empty or whitespace-only `name` would normalize to `""`, which is not a
   * valid Junie name and would make every such file share one import identity,
   * so it falls back to the file name just like a missing `name` does.
   */
  private getNormalizedName(): string {
    const explicitName =
      this.frontmatter.name === undefined ? "" : normalizeJunieName(this.frontmatter.name);
    return explicitName || normalizeJunieName(nameFromFileName(this.getRelativeFilePath()));
  }

  toRulesyncSubagent(): RulesyncSubagent {
    // `name` is resolved (and normalized) by `getNormalizedName()` below.
    const { name: _name, description, ...restFields } = this.frontmatter;

    const junieSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: this.getNormalizedName(),
      ...(description !== undefined && { description }),
      ...(Object.keys(junieSection).length > 0 && { junie: junieSection }),
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const junieSection = this.filterToolSpecificSection(rulesyncFrontmatter.junie ?? {}, [
      "name",
      "description",
    ]);

    const rawJunieFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...junieSection,
    };

    const junieFrontmatter = parseGeneratedSubagentFrontmatter({
      schema: JunieSubagentFrontmatterSchema,
      frontmatter: rawJunieFrontmatter,
      toolTarget: "junie",
      rulesyncSubagent,
    });

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, junieFrontmatter);

    const paths = this.getSettablePaths({ global });

    return new JunieSubagent({
      outputRoot,
      frontmatter: junieFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: JunieSubagentFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "junie",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<JunieSubagent> {
    // Honor an explicit discovery root (e.g. the `.agents/` import root) when
    // provided; otherwise fall back to the canonical `.junie/agents/` location.
    const dirPath = relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath;
    const filePath = join(outputRoot, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter: parsedFrontmatter, body: content } = parseFrontmatter(
      fileContent,
      filePath,
    );

    // `description` is optional upstream, so Junie's own body fallback is
    // applied before validation rather than failing a subagent Junie loads fine.
    let frontmatter = parsedFrontmatter;
    // A YAML null (`description:`) or a blank string counts as missing too.
    if (isRecord(frontmatter) && isMissingDescription(frontmatter.description)) {
      const { description: _missing, ...rest } = frontmatter;
      const derived = deriveDescriptionFromBody(content);
      frontmatter = derived === undefined ? rest : { ...rest, description: derived };
    }

    const result = JunieSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new JunieSubagent({
      outputRoot,
      relativeDirPath: dirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): JunieSubagent {
    return new JunieSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
