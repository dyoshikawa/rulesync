import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

const KiroCliSubagentJsonSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.nullable(z.string())),
  prompt: z.optional(z.nullable(z.string())),
  tools: z.optional(z.nullable(z.array(z.string()))),
  toolAliases: z.optional(z.nullable(z.record(z.string(), z.string()))),
  toolSettings: z.optional(z.nullable(z.unknown())),
  toolSchema: z.optional(z.nullable(z.unknown())),
  hooks: z.optional(z.nullable(z.record(z.string(), z.array(z.unknown())))),
  model: z.optional(z.nullable(z.string())),
  mcpServers: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
  useLegacyMcpJson: z.optional(z.nullable(z.boolean())),
  resources: z.optional(z.nullable(z.array(z.string()))),
  allowedTools: z.optional(z.nullable(z.array(z.string()))),
  includeMcpJson: z.optional(z.nullable(z.boolean())),
});

type KiroCliSubagentJson = z.infer<typeof KiroCliSubagentJsonSchema>;

export type KiroSubagentParams = {
  body: string;
} & AiFileParams;

export class KiroSubagent extends ToolSubagent {
  private readonly body: string;

  constructor({ body, ...rest }: KiroSubagentParams) {
    super({
      ...rest,
    });

    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".kiro", "agents"),
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    let parsed: KiroCliSubagentJson;
    try {
      parsed = JSON.parse(this.body);
    } catch (error) {
      throw new Error(
        `Failed to parse JSON in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    const { name, description, prompt, ...restFields } = parsed;

    // Build kiro section with all fields except name, description, and prompt
    const kiroSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["kiro"],
      name,
      description: description ?? "",
      // Only include kiro section if there are fields
      ...(Object.keys(kiroSection).length > 0 && { kiro: kiroSection }),
    };

    return new RulesyncSubagent({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: prompt ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.json$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection: Record<string, unknown> = frontmatter.kiro ?? {};
    const kiroSection = this.filterToolSpecificSection(rawSection, [
      "name",
      "description",
      "prompt",
    ]);

    // Build kiro JSON from rulesync frontmatter + kiro section (tool-specific fields only)
    const json: KiroCliSubagentJson = {
      name: frontmatter.name,
      description: frontmatter.description || null,
      prompt: rulesyncSubagent.getBody() || null,
      ...kiroSection,
    };

    const body = JSON.stringify(json, null, 2);
    const paths = this.getSettablePaths({ global });
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".json");

    return new KiroSubagent({
      baseDir,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: body,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    try {
      const parsed = JSON.parse(this.body);
      KiroCliSubagentJsonSchema.parse(parsed);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kiro",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KiroSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    const subagent = new KiroSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
      global,
    });

    if (validate) {
      const result = subagent.validate();
      if (!result.success) {
        throw new Error(
          `Invalid JSON in ${filePath}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
        );
      }
    }

    return subagent;
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): KiroSubagent {
    return new KiroSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
