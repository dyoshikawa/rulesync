import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema, ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
// Tool-specific sections (e.g., claudecode:) are preserved as additional keys
export const RulesyncSubagentFrontmatterSchema = z.looseObject({
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  name: z.string(),
  description: z.optional(z.string()),
  takt: z.optional(
    z.looseObject({
      name: z.optional(z.string()),
    }),
  ),
  roo: z.optional(
    z.looseObject({
      slug: z.optional(z.string()),
      whenToUse: z.optional(z.string()),
      roleDefinition: z.optional(z.string()),
      customInstructions: z.optional(z.string()),
      groups: z.optional(z.array(z.unknown())),
    }),
  ),
  // Zoo Code (community continuation of Roo Code): shared mode fields ride the
  // `roo:` section above; this section carries only the post-fork divergence.
  zoocode: z.optional(
    z.looseObject({
      /** Per-mode MCP server allowlist (Zoo Code v3.60.0+); omitted = all. */
      allowedMcpServers: z.optional(z.array(z.string())),
    }),
  ),
  // ZCode's documented subagent keys, spelled out so their types are checked
  // here rather than only once the file is written. They are camelCase and
  // case-sensitive; unknown keys still ride through, as everywhere else.
  zcode: z.optional(
    z.looseObject({
      model: z.optional(z.string()),
      thoughtLevel: z.optional(z.string()),
      color: z.optional(z.string()),
      tools: z.optional(z.array(z.string())),
      disallowedTools: z.optional(z.array(z.string())),
      maxTurns: z.optional(z.number().check(z.int(), z.positive())),
      injectAgentsMd: z.optional(z.boolean()),
      mcpServers: z.optional(z.array(z.string())),
    }),
  ),
  vibe: z.optional(
    z.looseObject({
      agent_type: z.optional(z.enum(["agent", "subagent"])),
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
    }),
  ),
});

// Input type allows targets to be omitted (will use default value)
type RulesyncSubagentFrontmatterInput = z.input<typeof RulesyncSubagentFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;
// Output type has targets always present after parsing
export type RulesyncSubagentFrontmatter = z.infer<typeof RulesyncSubagentFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;

export type RulesyncSubagentParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncSubagentFrontmatterInput;
  body: string;
};

export type RulesyncSubagentSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncSubagentFromFileParams = RulesyncFileFromFileParams;

export class RulesyncSubagent extends RulesyncFile {
  private readonly frontmatter: RulesyncSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncSubagentParams) {
    // Parse frontmatter to apply defaults and validate
    const parseResult = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`,
      );
    }
    // Apply defaults manually when validation is disabled but parsing failed
    // Merge with frontmatter to preserve tool-specific sections (looseObject passthrough)
    const parsedFrontmatter: RulesyncSubagentFrontmatter = parseResult.success
      ? { ...frontmatter, ...parseResult.data }
      : { ...frontmatter, targets: frontmatter?.targets ?? ["*"] };

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter),
    });

    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }

  static getSettablePaths(): RulesyncSubagentSettablePaths {
    return {
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncSubagentFrontmatterSchema.safeParse(this.frontmatter);

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

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: RulesyncSubagentFromFileParams): Promise<RulesyncSubagent> {
    // `relativeDirPath` overrides the class-level default when the caller
    // (a processor loading from a non-default source tree such as
    // `.rulesync.local/subagents`) needs to point at a tree whose basename
    // differs from `.rulesync`. See the `inputRoots` design note.
    const dirPath = relativeDirPath ?? this.getSettablePaths().relativeDirPath;
    const filePath = join(outputRoot, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content, hasFrontmatter } = parseFrontmatter(fileContent, filePath);

    if (!hasFrontmatter) {
      throw new Error(
        `Missing frontmatter in ${filePath}. Rulesync files must begin with a YAML frontmatter block delimited by '---'.`,
      );
    }

    // Validate frontmatter using SubagentFrontmatterSchema
    const result = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${formatError(result.error)}`);
    }

    const filename = basename(relativeFilePath);

    return new RulesyncSubagent({
      outputRoot,
      relativeDirPath: dirPath,
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
    });
  }
}
