import { basename, join } from "node:path";
import { z } from "zod/mini";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Kiro CLI Custom Agent JSON schema
 * Based on https://kiro.dev/docs/cli/custom-agents/configuration-reference/
 */
export const KiroCliSubagentJsonSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  prompt: z.optional(z.string()),
  tools: z.optional(z.array(z.string())),
  allowedTools: z.optional(z.array(z.string())),
  model: z.optional(z.string()),
  mcpServers: z.optional(z.record(z.string(), z.unknown())),
  resources: z.optional(z.array(z.string())),
  includeMcpJson: z.optional(z.boolean()),
});

export type KiroCliSubagentJson = z.infer<typeof KiroCliSubagentJsonSchema>;

export type KiroCliSubagentParams = {
  json: KiroCliSubagentJson;
} & AiFileParams;

/**
 * Subagent generator for Kiro CLI
 *
 * Generates custom agent configuration files for Kiro CLI.
 * Outputs to .kiro/agents/ directory as JSON files.
 */
export class KiroCliSubagent extends ToolSubagent {
  private readonly json: KiroCliSubagentJson;

  constructor({ json, ...rest }: KiroCliSubagentParams) {
    if (rest.validate !== false) {
      const result = KiroCliSubagentJsonSchema.safeParse(json);
      if (!result.success) {
        throw new Error(
          `Invalid JSON in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.json = json;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".kiro", "agents"),
    };
  }

  getJson(): KiroCliSubagentJson {
    return this.json;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.json;
  }

  getBody(): string {
    return this.json.prompt ?? "";
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, prompt, ...kirocliSection } = this.json;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["kirocli"],
      name,
      description,
      kirocli: kirocliSection,
    };

    return new RulesyncSubagent({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: prompt ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(".json", ".md"),
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
    const kirocliSection = rulesyncFrontmatter.kirocli ?? {};

    const kirocliJson: KiroCliSubagentJson = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(rulesyncSubagent.getBody() && { prompt: rulesyncSubagent.getBody() }),
      ...kirocliSection,
    };

    const fileContent = JSON.stringify(kirocliJson, null, 2);
    const paths = this.getSettablePaths({ global });

    return new KiroCliSubagent({
      baseDir,
      json: kirocliJson,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath().replace(".md", ".json"),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.json) {
      return { success: true, error: null };
    }

    const result = KiroCliSubagentJsonSchema.safeParse(this.json);
    if (result.success) {
      return { success: true, error: null };
    }

    return {
      success: false,
      error: new Error(
        `Invalid JSON in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kirocli",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KiroCliSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const json = JSON.parse(fileContent);

    const result = KiroCliSubagentJsonSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`Invalid JSON in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiroCliSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      json: result.data,
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): KiroCliSubagent {
    return new KiroCliSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      json: { name: "", description: "" },
      fileContent: "{}",
      validate: false,
    });
  }
}
