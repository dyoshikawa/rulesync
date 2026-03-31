import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export const KiloSubagentFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  mode: z._default(z.string(), "subagent"),
  name: z.optional(z.string()),
});

export type KiloSubagentFrontmatter = z.infer<typeof KiloSubagentFrontmatterSchema>;

export type KiloSubagentParams = {
  frontmatter: KiloSubagentFrontmatter;
  body: string;
} & AiFileParams;

export class KiloSubagent extends ToolSubagent {
  private readonly frontmatter: KiloSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: KiloSubagentParams) {
    if (rest.validate !== false) {
      const result = KiloSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? join(".config", "kilo", "agent") : join(".kilo", "agent"),
    };
  }

  getFrontmatter(): KiloSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { description, mode, name, ...kiloSection } = this.frontmatter;
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? basename(this.getRelativeFilePath(), ".md"),
      description,
      kilo: { mode, ...kiloSection },
    };

    return new RulesyncSubagent({
      baseDir: ".", // RulesyncSubagent baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const kiloSection = rulesyncFrontmatter.kilo ?? {};

    const kiloFrontmatter: KiloSubagentFrontmatter = {
      ...kiloSection,
      description: rulesyncFrontmatter.description,
      mode: typeof kiloSection.mode === "string" ? kiloSection.mode : "subagent",
      ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, kiloFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new KiloSubagent({
      baseDir,
      frontmatter: kiloFrontmatter,
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

    const result = KiloSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }

    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kilo",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KiloSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = KiloSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiloSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): KiloSubagent {
    return new KiloSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
