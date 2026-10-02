import { basename, join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import {
  VIBE_PLUGIN_AGENTS_DIR_NAME,
  VIBE_PLUGIN_EXTENSION_DIR,
} from "../../constants/plugin-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  type ToolSubagentForDeletionParams,
  type ToolSubagentFromFileParams,
  type ToolSubagentFromRulesyncSubagentParams,
  type ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * The `vibe` section keys a plugin agent document accepts besides the ones
 * rulesync derives itself (`schema_version`, `agent_type`, `description`,
 * `instructions`). The document is `extra="forbid"`, so anything else — such
 * as `system_prompt_id` or `compaction_prompt` of `.vibe/agents/*.toml` — would
 * make Vibe reject the agent, and is dropped with a warning instead.
 */
const VIBE_PLUGIN_AGENT_SECTION_FIELDS = [
  "display_name",
  "safety",
  "active_model",
  "enabled_tools",
  "disabled_tools",
  "tools",
] as const;

/** Keys of the `vibe` section rulesync writes from other sources. */
const VIBE_PLUGIN_AGENT_DERIVED_FIELDS: ReadonlySet<string> = new Set([
  "agent_type",
  "description",
]);

/** Vibe's plugin component names: lowercase kebab-case. */
const VIBE_PLUGIN_AGENT_FILE_STEM_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const VIBE_PLUGIN_AGENT_DESCRIPTION_MAX_LENGTH = 300;

export const VibePluginAgentTomlSchema = z.looseObject({
  schema_version: z.literal(1),
  agent_type: z.literal("subagent"),
  display_name: z.optional(z.string()),
  description: z.string(),
  safety: z.optional(z.string()),
  active_model: z.optional(z.string()),
  instructions: z.optional(z.string()),
  enabled_tools: z.optional(z.array(z.string())),
  disabled_tools: z.optional(z.array(z.string())),
  tools: z.optional(z.record(z.string(), z.looseObject({}))),
});

type VibePluginAgentToml = z.infer<typeof VibePluginAgentTomlSchema>;

/**
 * Keep the `vibe` section keys a plugin agent document accepts, warning about
 * the rest and about an `agent_type` other than subagent.
 */
function pickVibePluginAgentSection({
  rawSection,
  relativeFilePath,
  logger,
}: {
  rawSection: Record<string, unknown>;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const allowed: ReadonlySet<string> = new Set(VIBE_PLUGIN_AGENT_SECTION_FIELDS);
  const section: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(rawSection)) {
    if (allowed.has(key)) {
      section[key] = value;
    } else if (!VIBE_PLUGIN_AGENT_DERIVED_FIELDS.has(key)) {
      dropped.push(key);
    }
  }
  if (dropped.length > 0) {
    logger?.warn(
      `Dropping ${dropped.join(", ")} from vibe-plugin subagent ${relativeFilePath}: ` +
        `Vibe's plugin agent document does not accept these fields.`,
    );
  }
  if (rawSection.agent_type === "agent") {
    logger?.warn(
      `vibe-plugin subagent ${relativeFilePath} sets agent_type "agent", but a Vibe plugin ` +
        `can ship only subagents, so it is written as a subagent.`,
    );
  }
  return section;
}

/** Vibe requires a non-empty description of at most 300 characters. */
function resolveVibePluginAgentDescription({
  authored,
  name,
  relativeFilePath,
  logger,
}: {
  authored: string | undefined;
  name: string;
  relativeFilePath: string;
  logger?: Logger;
}): string {
  const description = authored !== undefined && authored !== "" ? authored : name;
  if (description !== authored) {
    logger?.warn(
      `vibe-plugin subagent ${relativeFilePath} has no description, which Vibe requires; ` +
        `using its name instead.`,
    );
  }
  if (description.length > VIBE_PLUGIN_AGENT_DESCRIPTION_MAX_LENGTH) {
    logger?.warn(
      `vibe-plugin subagent ${relativeFilePath} has a description longer than ` +
        `${VIBE_PLUGIN_AGENT_DESCRIPTION_MAX_LENGTH} characters, so Vibe will reject the agent.`,
    );
  }
  return description;
}

/**
 * Subagent inside a Vibe plugin bundle
 * (`<plugin>/ai.mistral.vibe/agents/<name>.toml`). Unlike `.vibe/agents/`, the
 * prompt travels inside the document as `instructions` instead of a companion
 * `.vibe/prompts/<id>.md`, and the agent is always a subagent. The directory
 * is loaded only when `plugin.json` declares the `ai.mistral.vibe` extension.
 *
 * @see https://github.com/mistralai/mistral-vibe/blob/v2.25.8/vibe/core/plugins/_native.py
 */
export class VibePluginSubagent extends ToolSubagent {
  private readonly body: string;

  constructor({ body, ...rest }: { body: string } & AiFileParams) {
    if (rest.validate !== false) {
      try {
        VibePluginAgentTomlSchema.parse(smolToml.parse(body));
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

  static getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: join(VIBE_PLUGIN_EXTENSION_DIR, VIBE_PLUGIN_AGENTS_DIR_NAME) };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    let parsed: VibePluginAgentToml;
    try {
      parsed = VibePluginAgentTomlSchema.parse(smolToml.parse(this.body));
    } catch (error) {
      throw new Error(
        `Failed to parse TOML in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const {
      schema_version: _schemaVersion,
      agent_type: _agentType,
      instructions,
      description,
      display_name,
      ...vibeSection
    } = parsed;
    const fileStem = basename(this.getRelativeFilePath(), ".toml");
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name: display_name ?? fileStem,
      description,
      vibe: {
        ...(display_name !== undefined && { display_name }),
        ...vibeSection,
      },
    };

    return new RulesyncSubagent({
      outputRoot: ".", // RulesyncSubagent outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: instructions ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.toml$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection: Record<string, unknown> = frontmatter.vibe ?? {};
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".toml");

    const section = pickVibePluginAgentSection({ rawSection, relativeFilePath, logger });
    const description = resolveVibePluginAgentDescription({
      authored:
        frontmatter.description ??
        (typeof rawSection.description === "string" ? rawSection.description : undefined),
      name: frontmatter.name,
      relativeFilePath,
      logger,
    });
    const fileStem = basename(relativeFilePath, ".toml");
    if (!VIBE_PLUGIN_AGENT_FILE_STEM_PATTERN.test(fileStem)) {
      logger?.warn(
        `vibe-plugin subagent ${relativeFilePath}: Vibe requires a lowercase kebab-case ` +
          `file name for plugin agents, so it will reject this agent.`,
      );
    }

    const body = rulesyncSubagent.getBody();
    const tomlObj: VibePluginAgentToml = {
      schema_version: 1,
      agent_type: "subagent",
      display_name:
        typeof section.display_name === "string" ? section.display_name : frontmatter.name,
      description,
      ...section,
      ...(body ? { instructions: body } : {}),
    };
    const fileContent = smolToml.stringify(tomlObj);

    return new VibePluginSubagent({
      outputRoot,
      body: fileContent,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    try {
      VibePluginAgentTomlSchema.parse(smolToml.parse(this.body));
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
      toolTarget: "vibe-plugin",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolSubagentFromFileParams): Promise<VibePluginSubagent> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    return new VibePluginSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): VibePluginSubagent {
    return new VibePluginSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
