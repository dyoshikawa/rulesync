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
  maxTurns: z.optional(z.number().check(z.int(), z.positive())),
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
 * agent, under `.zcode/agents/` (project) or `~/.zcode/agents/` (global).
 *
 * The docs describe only the user directory (the Settings UI edits user-level
 * subagents alone), but the agent runtime also loads `<cwd>/.zcode/agents/` as
 * the project source — observed in the v3.14.3 runtime. Project profiles are
 * parsed like user ones except that `permissionMode` is discarded, so it is
 * not written for the project scope.
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
    // The same relative path serves both scopes; the processor supplies the
    // home directory as outputRoot in global mode.
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
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const fullSection = rulesyncFrontmatter.zcode ?? {};
    // ZCode discards `permissionMode` on project-scope subagents, so it is
    // written only for the global scope.
    const { permissionMode, ...projectSection } = fullSection;
    if (!global && permissionMode !== undefined) {
      logger?.warn(
        `Dropping "permissionMode" from ZCode subagent "${rulesyncSubagent.getRelativeFilePath()}": ` +
          `ZCode ignores it on project-scope subagents (it is honored in ~/.zcode/agents/ only).`,
      );
    }
    const zcodeSection = global ? fullSection : projectSection;

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
