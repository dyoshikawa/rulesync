import { join } from "node:path";
import * as smolToml from "smol-toml";
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

export const CodexCliSubagentTomlSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  developer_instructions: z.optional(z.string()),
  model: z.optional(z.string()),
  model_reasoning_effort: z.optional(z.string()),
  sandbox_mode: z.optional(z.string()),
});

type CodexCliSubagentToml = z.infer<typeof CodexCliSubagentTomlSchema>;

export type CodexCliSubagentParams = {
  body: string;
} & AiFileParams;

export class CodexCliSubagent extends ToolSubagent {
  private readonly body: string;

  constructor({ body, ...rest }: CodexCliSubagentParams) {
    super({
      ...rest,
    });

    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".codex", "agents"),
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const parsed = CodexCliSubagentTomlSchema.parse(smolToml.parse(this.body));
    const { name, description, developer_instructions, ...restFields } = parsed;

    // Build codexcli section with all fields except name, description, and developer_instructions
    const codexcliSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["codexcli"],
      name,
      description: description ?? "",
      // Only include codexcli section if there are fields
      ...(Object.keys(codexcliSection).length > 0 && { codexcli: codexcliSection }),
    };

    return new RulesyncSubagent({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: developer_instructions ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.toml$/, ".md"),
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
    const codexcliSection = frontmatter.codexcli ?? {};

    // Build TOML object from rulesync frontmatter + codexcli section
    const tomlObj: CodexCliSubagentToml = {
      name: frontmatter.name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      ...(rulesyncSubagent.getBody() ? { developer_instructions: rulesyncSubagent.getBody() } : {}),
      ...codexcliSection,
    };

    const body = smolToml.stringify(tomlObj);
    const paths = this.getSettablePaths({ global });
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".toml");

    return new CodexCliSubagent({
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
      const parsed = smolToml.parse(this.body);
      CodexCliSubagentTomlSchema.parse(parsed);
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
      toolTarget: "codexcli",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<CodexCliSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    return new CodexCliSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): CodexCliSubagent {
    return new CodexCliSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
