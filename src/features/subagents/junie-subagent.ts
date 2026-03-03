import { join } from "node:path";

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

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const JunieSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

export type JunieSubagentFrontmatter = z.infer<typeof JunieSubagentFrontmatterSchema>;

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
    return {
      relativeDirPath: join(".junie", "agents"),
    };
  }

  getFrontmatter(): JunieSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    // Build junie section with any extra fields
    const junieSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      // Only include junie section if there are fields
      ...(Object.keys(junieSection).length > 0 && { junie: junieSection }),
    };

    return new RulesyncSubagent({
      baseDir: ".",
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
    const junieSection = rulesyncFrontmatter.junie ?? {};

    const rawJunieFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...junieSection,
    };

    const result = JunieSubagentFrontmatterSchema.safeParse(rawJunieFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid junie subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const junieFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, junieFrontmatter);

    const paths = this.getSettablePaths({ global });

    return new JunieSubagent({
      baseDir,
      frontmatter: junieFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = JunieSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "junie",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<JunieSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = JunieSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new JunieSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): JunieSubagent {
    return new JunieSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
