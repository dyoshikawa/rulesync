import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ZCODE_AGENTS_DIR_PATH } from "../../constants/zcode-paths.js";
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

// ZCode subagent frontmatter. The keys are camelCase and case-sensitive:
// `name` and `description` are required, and `model`, `thoughtLevel`, `color`,
// `tools` / `disallowedTools`, `maxTurns`, `injectAgentsMd` and `mcpServers`
// are optional. See https://zcode.z.ai/en/docs/subagents
// looseObject preserves unknown keys so future fields round-trip cleanly.
const ZcodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
  thoughtLevel: z.optional(z.string()),
  color: z.optional(z.string()),
  tools: z.optional(z.array(z.string())),
  disallowedTools: z.optional(z.array(z.string())),
  maxTurns: z.optional(z.number()),
  injectAgentsMd: z.optional(z.boolean()),
  mcpServers: z.optional(z.array(z.string())),
});

type ZcodeSubagentFrontmatter = z.infer<typeof ZcodeSubagentFrontmatterSchema>;

type ZcodeSubagentParams = {
  frontmatter: ZcodeSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * ZCode subagents.
 *
 * Each subagent is one Markdown file with YAML frontmatter, named after the
 * agent, under `~/.zcode/agents/`.
 *
 * Global scope only. The current Beta "manages global / user-level subagents
 * stored under `~/.zcode/agents/`", and creating or editing workspace /
 * project-level subagents "is not available yet" — so this adapter is
 * registered with `supportsProject: false` and never writes into a project's
 * own `.zcode/`. The relative path is nonetheless spelled against
 * {@link ZCODE_AGENTS_DIR_PATH} so the workspace scope needs nothing more than
 * flipping that flag if ZCode ships it.
 *
 * @see https://zcode.z.ai/en/docs/subagents
 */
export class ZcodeSubagent extends ToolSubagent {
  private readonly frontmatter: ZcodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: ZcodeSubagentParams) {
    if (rest.validate !== false) {
      const result = ZcodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Only the global scope is ever asked for; the processor supplies the home
    // directory as outputRoot in that mode.
    return {
      relativeDirPath: ZCODE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): ZcodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...rest } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      // Round-trip the tool-specific fields (model/thoughtLevel/color/tools/
      // disallowedTools/maxTurns/injectAgentsMd/mcpServers and any future keys)
      // through a dedicated zcode section.
      ...(Object.keys(rest).length > 0 && { zcode: rest }),
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
    const zcodeSection = rulesyncFrontmatter.zcode ?? {};

    const zcodeFrontmatter: ZcodeSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...zcodeSection,
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, zcodeFrontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new ZcodeSubagent({
      outputRoot,
      frontmatter: zcodeFrontmatter,
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

    const result = ZcodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "zcode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<ZcodeSubagent> {
    const dirPath = relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath;
    const filePath = join(outputRoot, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = ZcodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ZcodeSubagent({
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
  }: ToolSubagentForDeletionParams): ZcodeSubagent {
    return new ZcodeSubagent({
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
