import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ZERO_SPECIALISTS_DIR_PATH, zeroGlobalSpecialistsDir } from "../../constants/zero-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
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
 * Frontmatter of a Zero specialist manifest. `tools` is a list of tool ids or
 * categories (`read-only`, `edit`, `execute`, `plan`).
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/SPECIALISTS.md
 */
const ZeroSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  extends: z.optional(z.string()),
  model: z.optional(z.string()),
  reasoningEffort: z.optional(z.string()),
  tools: z.optional(z.array(z.string())),
});

export type ZeroSubagentFrontmatter = z.infer<typeof ZeroSubagentFrontmatterSchema>;

export type ZeroSubagentParams = {
  frontmatter: ZeroSubagentFrontmatter;
  body: string;
} & AiFileParams;

/** The frontmatter keys Zero reads besides `name` and `description`. */
const ZERO_SECTION_KEYS = ["extends", "model", "reasoningEffort", "tools"] as const;

/**
 * Zero rejects a specialist whose name is not a lowercase id.
 * @see https://github.com/Twigpine/zero/blob/main/internal/specialist/manifest.go
 */
const ZERO_SPECIALIST_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * `tools` as Zero's list. The comma-separated spelling (`read-only,plan`) is
 * accepted from the `zero` section and split, since Zero's manifest parser
 * only reads a list.
 */
function toToolList(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return items.length > 0 ? items : undefined;
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return undefined;
}

/**
 * Subagent generator for Zero, whose subagents are "specialists".
 *
 * Zero reads specialist manifests — Markdown with frontmatter, the body being
 * the system prompt — from `.zero/specialists/*.md` (project) and
 * `<user config dir>/zero/specialists/*.md` (`~/.config/zero/specialists/` on
 * Linux and macOS, `%AppData%\zero\specialists\` on Windows). A project
 * specialist overrides a user one, which overrides a built-in.
 *
 * rulesync writes `name` and `description`, plus `extends`, `model`,
 * `reasoningEffort` and `tools` from the `zero` section. Zero parses the
 * frontmatter line by line (no multi-line values), so strings are kept on one
 * line, and `tools` is always a list.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/SPECIALISTS.md
 * @see https://github.com/Twigpine/zero/blob/main/internal/specialist/manifest.go
 */
export class ZeroSubagent extends ToolSubagent {
  private readonly frontmatter: ZeroSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ZeroSubagentParams) {
    if (rest.validate !== false) {
      const result = ZeroSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({ ...rest });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? zeroGlobalSpecialistsDir() : ZERO_SPECIALISTS_DIR_PATH,
    };
  }

  getFrontmatter(): ZeroSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name,
      ...(description && { description }),
      ...(Object.keys(restFields).length > 0 && { zero: restFields }),
    };

    return new RulesyncSubagent({
      outputRoot: ".", // RulesyncSubagent outputRoot is always the project root directory
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
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const section = isRecord(rulesyncFrontmatter.zero) ? rulesyncFrontmatter.zero : {};

    const zeroSection: Record<string, unknown> = {};
    for (const key of ZERO_SECTION_KEYS) {
      const value = key === "tools" ? toToolList(section[key]) : section[key];
      if (value !== undefined) zeroSection[key] = value;
    }

    const zeroFrontmatter = parseGeneratedSubagentFrontmatter({
      schema: ZeroSubagentFrontmatterSchema,
      frontmatter: {
        name: rulesyncFrontmatter.name,
        ...(rulesyncFrontmatter.description && { description: rulesyncFrontmatter.description }),
        ...zeroSection,
      },
      toolTarget: "zero",
      rulesyncSubagent,
    });

    const filePath = rulesyncSubagent.getRelativeFilePath();
    if (!ZERO_SPECIALIST_NAME_PATTERN.test(zeroFrontmatter.name)) {
      logger?.warn(
        `Zero specialist ${quoteValueForWarning(zeroFrontmatter.name)} (${filePath}): Zero only ` +
          `loads lowercase names of letters, numbers and dashes, so it will reject this specialist.`,
      );
    }
    if (!zeroFrontmatter.description && !zeroFrontmatter.extends) {
      logger?.warn(
        `Zero specialist ${quoteValueForWarning(zeroFrontmatter.name)} (${filePath}) has no ` +
          `description, which Zero requires unless "zero.extends" is set.`,
      );
    }

    const body = rulesyncSubagent.getBody();

    return new ZeroSubagent({
      outputRoot,
      frontmatter: zeroFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: filePath,
      fileContent: stringifyFrontmatter(body, zeroFrontmatter, { avoidBlockScalars: true }),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: ZeroSubagentFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "zero",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<ZeroSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = ZeroSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ZeroSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): ZeroSubagent {
    return new ZeroSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
