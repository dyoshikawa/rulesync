import { basename, join } from "node:path";

import * as smolToml from "smol-toml";
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

export const VibeSubagentTomlSchema = z.looseObject({
  agent_type: z.enum(["agent", "subagent"]),
  display_name: z.optional(z.string()),
  description: z.optional(z.string()),
  safety: z.optional(z.string()),
  active_model: z.optional(z.string()),
  system_prompt: z.optional(z.string()),
  system_prompt_id: z.optional(z.string()),
  compaction_prompt: z.optional(z.string()),
  compaction_prompt_id: z.optional(z.string()),
  enabled_tools: z.optional(z.array(z.string())),
  disabled_tools: z.optional(z.array(z.string())),
  tools: z.optional(z.record(z.string(), z.looseObject({}))),
});

type VibeSubagentToml = z.infer<typeof VibeSubagentTomlSchema>;

export type VibeSubagentParams = {
  body: string;
} & AiFileParams;

export class VibeSubagent extends ToolSubagent {
  private readonly body: string;

  constructor({ body, ...rest }: VibeSubagentParams) {
    if (rest.validate !== false) {
      try {
        VibeSubagentTomlSchema.parse(smolToml.parse(body));
      } catch (error) {
        throw new Error(
          `Invalid TOML in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(error)}`,
          { cause: error },
        );
      }
    }

    super({ ...rest });
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".vibe", "agents"),
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    let parsed: VibeSubagentToml;
    try {
      parsed = VibeSubagentTomlSchema.parse(smolToml.parse(this.body));
    } catch (error) {
      throw new Error(
        `Failed to parse TOML in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const { system_prompt, description, display_name, ...vibeSection } = parsed;
    const fileStem = basename(this.getRelativeFilePath(), ".toml");
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["vibe"],
      name: display_name ?? fileStem,
      ...(description !== undefined && { description }),
      vibe: {
        ...(display_name !== undefined && { display_name }),
        ...(description !== undefined && { description }),
        ...vibeSection,
      },
    };

    return new RulesyncSubagent({
      outputRoot: this.outputRoot,
      frontmatter: rulesyncFrontmatter,
      body: system_prompt ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.toml$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection: Record<string, unknown> = frontmatter.vibe ?? {};
    const vibeSection = this.filterToolSpecificSection(rawSection, [
      "agent_type",
      "display_name",
      "description",
      "system_prompt",
    ]);

    const tomlObj: VibeSubagentToml = {
      agent_type: rawSection.agent_type === "agent" ? "agent" : "subagent",
      display_name:
        typeof rawSection.display_name === "string" ? rawSection.display_name : frontmatter.name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      ...(rulesyncSubagent.getBody() ? { system_prompt: rulesyncSubagent.getBody() } : {}),
      ...vibeSection,
    };

    const body = smolToml.stringify(tomlObj);
    const paths = this.getSettablePaths({ global });
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".toml");

    return new VibeSubagent({
      outputRoot,
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
      VibeSubagentTomlSchema.parse(smolToml.parse(this.body));
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
      toolTarget: "vibe",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<VibeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    const subagent = new VibeSubagent({
      outputRoot,
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
        throw new Error(`Invalid TOML in ${filePath}: ${formatError(result.error)}`);
      }
    }

    return subagent;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): VibeSubagent {
    return new VibeSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
