import { join } from "node:path";

import { z } from "zod/mini";

import {
  POOL_DIR,
  POOL_GENERAL_AGENT_NAME,
  POOL_GLOBAL_DIR,
  POOL_SETTINGS_FILE_NAME,
  POOL_SUBAGENTS_AGENTS_KEY,
  POOL_SUBAGENTS_KEY,
} from "../../constants/pool-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/** How Pool runs an agent; a custom agent defaults to `in_process`. */
const POOL_AGENT_TYPES = ["in_process", "command", "agent_server"] as const;

const DEFAULT_POOL_AGENT_TYPE = "in_process";

/**
 * One entry of `subagents.agents.<name>` in Pool's settings file. `type` is
 * required by Pool and `description` by every enabled custom agent; the
 * remaining keys depend on the type (`command`/`args`/`env` for `command`,
 * `agent_server`/`session_config_options` for `agent_server`). Loose so a key
 * Pool adds later survives the round-trip.
 * @see https://docs.poolside.ai/subagents
 * @see https://docs.poolside.ai/settings-file-reference
 */
export const PoolAgentSchema = z.looseObject({
  type: z.optional(z.enum(POOL_AGENT_TYPES)),
  description: z.optional(z.string()),
  instructions: z.optional(z.string()),
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  env: z.optional(z.record(z.string(), z.string())),
  agent_server: z.optional(z.string()),
  session_config_options: z.optional(z.record(z.string(), z.unknown())),
  inherit_agent_config: z.optional(z.boolean()),
  disabled: z.optional(z.boolean()),
});

export type PoolAgent = z.infer<typeof PoolAgentSchema>;

export type PoolSubagentParams = {
  /** The `subagents.agents` entries rulesync generates, keyed by agent name. */
  agents: Record<string, PoolAgent>;
  logger?: Logger;
} & Omit<AiFileParams, "fileContent">;

/**
 * Single spelling of the settings.yaml codec/policy, matching PoolMcp: fail
 * closed on an unparseable root rather than replacing the user's primary Pool
 * settings with generated output.
 */
function parsePoolSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "yaml",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * The file stem an imported agent lands under in `.rulesync/subagents/`. Pool
 * keys agents by an arbitrary YAML mapping key, so the name is narrowed to a
 * safe file name before it becomes a path (defense in depth on top of the
 * central path-traversal guard); the agent keeps its real name in `name`.
 */
export function sanitizePoolAgentFileStem(raw: string): string {
  const stem = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "agent";
}

/**
 * Read `subagents.agents` out of a parsed settings document. The reserved
 * `general` agent is Pool's built-in and stays the user's to configure, so it
 * is never imported; an entry that is not a mapping is skipped.
 */
function agentsOfSettings({
  settings,
  filePath,
  logger,
}: {
  settings: Record<string, unknown>;
  filePath: string;
  logger?: Logger;
}): Record<string, PoolAgent> {
  const block = settings[POOL_SUBAGENTS_KEY];
  const rawAgents = isRecord(block) ? block[POOL_SUBAGENTS_AGENTS_KEY] : undefined;
  const agents: Record<string, PoolAgent> = {};
  if (!isRecord(rawAgents)) {
    return agents;
  }
  for (const [name, raw] of Object.entries(rawAgents)) {
    if (isPrototypePollutionKey(name) || name === POOL_GENERAL_AGENT_NAME) {
      continue;
    }
    const result = PoolAgentSchema.safeParse(raw);
    if (!result.success) {
      logger?.warn(
        `Skipped Pool subagent ${quoteValueForWarning(name)} in ${filePath}: ${formatError(result.error)}`,
      );
      continue;
    }
    agents[name] = result.data;
  }
  return agents;
}

/**
 * Pool subagents.
 *
 * Pool defines subagents inside its settings file — `.poolside/settings.yaml`
 * at project scope and `~/.config/poolside/settings.yaml` at user scope —
 * under `subagents.agents.<name>`, so every targeted rulesync subagent is
 * collapsed into that one file: the body becomes `instructions`, the shared
 * `description` is written as-is and the `pool:` frontmatter section supplies
 * `type` (default `in_process`) and the type-specific keys. rulesync owns the
 * `agents` map except for Pool's built-in `general` entry, which is carried
 * over untouched together with `subagents.default` and every other top-level
 * key of the file (`mcp_servers`, `tools`, `pool`, ...); the file is never
 * deleted.
 *
 * @see https://docs.poolside.ai/subagents
 * @see https://docs.poolside.ai/settings-file-reference
 */
export class PoolSubagent extends ToolSubagent {
  private readonly agents: Record<string, PoolAgent>;
  private readonly logger: Logger | undefined;
  /**
   * The settings document to write, built lazily: the writer hands over the
   * existing file through `setFileContent` first, and a file that does not
   * exist yet gets the block merged into an empty document. Lazy so that a
   * `forDeletion` instance never consults the gateway.
   */
  private mergedContent: string | null = null;

  constructor({ agents, logger, ...rest }: PoolSubagentParams) {
    super({ ...rest, fileContent: "" });
    this.agents = agents;
    this.logger = logger;
  }

  getAgents(): Record<string, PoolAgent> {
    return this.agents;
  }

  override isDeletable(): boolean {
    // settings.yaml is Pool's primary settings file, so it must never be
    // removed wholesale; clearing subagents happens via an in-place merge.
    return false;
  }

  override shouldMergeExistingFileContent(): boolean {
    return true;
  }

  override setFileContent(newFileContent: string): void {
    this.mergedContent = this.mergeInto(newFileContent);
  }

  override getFileContent(): string {
    if (this.mergedContent === null) {
      this.mergedContent = this.mergeInto("");
    }
    return this.mergedContent;
  }

  /**
   * Rebuild the `subagents` block on top of an existing settings document:
   * `default` and any other sibling of `agents` are kept, the built-in
   * `general` agent is carried over, and every other agent is replaced by the
   * generated set — an agent removed from `.rulesync/subagents/` must not
   * survive here. A block left empty is retracted rather than written as `{}`.
   */
  private mergeInto(existingContent: string): string {
    const paths = {
      relativeDirPath: this.getRelativeDirPath(),
      relativeFilePath: this.getRelativeFilePath(),
    };
    const filePath = join(this.getOutputRoot(), paths.relativeDirPath, paths.relativeFilePath);
    const existing = parsePoolSettings(existingContent, filePath);
    const existingBlock = isRecord(existing[POOL_SUBAGENTS_KEY])
      ? existing[POOL_SUBAGENTS_KEY]
      : {};

    const block: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existingBlock)) {
      if (!isPrototypePollutionKey(key) && key !== POOL_SUBAGENTS_AGENTS_KEY) {
        block[key] = value;
      }
    }

    const existingAgents = isRecord(existingBlock[POOL_SUBAGENTS_AGENTS_KEY])
      ? existingBlock[POOL_SUBAGENTS_AGENTS_KEY]
      : {};
    const general = existingAgents[POOL_GENERAL_AGENT_NAME];
    const agents: Record<string, unknown> = {
      ...(general !== undefined ? { [POOL_GENERAL_AGENT_NAME]: general } : {}),
      ...this.agents,
    };
    if (Object.keys(agents).length > 0) {
      block[POOL_SUBAGENTS_AGENTS_KEY] = agents;
    }

    return applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "subagents",
      existingContent,
      patch: { [POOL_SUBAGENTS_KEY]: Object.keys(block).length > 0 ? block : undefined },
      filePath,
      logger: this.logger,
    });
  }

  /**
   * Every agent lives in the one settings file, which the MCP feature writes
   * too: naming the file here keeps the gitignore derivation from claiming the
   * whole directory and lets the shared-file derivation order the writers.
   */
  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? POOL_GLOBAL_DIR : POOL_DIR,
      relativeFilePath: POOL_SETTINGS_FILE_NAME,
    };
  }

  /**
   * Map a single rulesync subagent to a Pool agent entry. The body becomes
   * `instructions` and the shared `description` is written as-is; the
   * optional `pool:` section supplies `type` and the type-specific keys and
   * may override both. Returns `null` for the reserved `general` name, which
   * Pool defines itself.
   */
  static toPoolAgent({
    rulesyncSubagent,
    logger,
  }: {
    rulesyncSubagent: RulesyncSubagent;
    logger?: Logger;
  }): { name: string; agent: PoolAgent } | null {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const name = frontmatter.name;
    if (name === POOL_GENERAL_AGENT_NAME) {
      logger?.warn(
        `Pool subagent ${quoteValueForWarning(name)} was skipped: "${POOL_GENERAL_AGENT_NAME}" ` +
          `is Pool's built-in agent, so configure it in settings.yaml directly.`,
      );
      return null;
    }
    if (isPrototypePollutionKey(name)) {
      logger?.warn(`Pool subagent ${quoteValueForWarning(name)} was skipped: unsafe name.`);
      return null;
    }

    const rawSection = isRecord(frontmatter.pool) ? frontmatter.pool : {};
    const result = PoolAgentSchema.safeParse(rawSection);
    if (!result.success) {
      throw new Error(
        `Invalid "pool" section of subagent ${quoteValueForWarning(name)}: ${formatError(result.error)}`,
      );
    }
    const { type, description, instructions, ...rest } = result.data;
    const body = rulesyncSubagent.getBody().trim();
    const effectiveDescription = description ?? frontmatter.description;
    const effectiveInstructions = instructions ?? (body !== "" ? body : undefined);

    if (effectiveDescription === undefined && rest.disabled !== true) {
      logger?.warn(
        `Pool subagent ${quoteValueForWarning(name)} has no description; Pool requires one ` +
          `for every enabled custom agent.`,
      );
    }

    // `type` first, the way Pool's docs spell an entry, then the prose keys.
    const agent: PoolAgent = {
      type: type ?? DEFAULT_POOL_AGENT_TYPE,
      ...(effectiveDescription !== undefined ? { description: effectiveDescription } : {}),
      ...(effectiveInstructions !== undefined ? { instructions: effectiveInstructions } : {}),
      ...rest,
    };
    return { name, agent };
  }

  /**
   * Aggregate every targeted rulesync subagent into the one settings file.
   * Agents are keyed by their `name`; a repeated name keeps the last one, with
   * a warning, so the map stays what Pool would read.
   */
  static fromRulesyncSubagents({
    outputRoot = process.cwd(),
    rulesyncSubagents,
    validate = true,
    global = false,
    logger,
  }: {
    outputRoot?: string;
    rulesyncSubagents: RulesyncSubagent[];
    validate?: boolean;
    global?: boolean;
    logger?: Logger;
  }): PoolSubagent {
    const agents: Record<string, PoolAgent> = {};
    for (const rulesyncSubagent of rulesyncSubagents) {
      const converted = this.toPoolAgent({ rulesyncSubagent, logger });
      if (converted === null) {
        continue;
      }
      if (Object.hasOwn(agents, converted.name)) {
        logger?.warn(
          `Pool subagent ${quoteValueForWarning(converted.name)} is defined more than once; ` +
            `the last definition (${rulesyncSubagent.getRelativePathFromCwd()}) wins.`,
        );
      }
      agents[converted.name] = converted.agent;
    }

    return new this({
      outputRoot,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: POOL_SETTINGS_FILE_NAME,
      agents,
      validate,
      global,
      logger,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): PoolSubagent {
    return this.fromRulesyncSubagents({
      outputRoot,
      rulesyncSubagents: [rulesyncSubagent],
      validate,
      global,
      logger,
    });
  }

  /**
   * Convert every custom agent of the settings file back into an individual
   * rulesync subagent. `instructions` becomes the body, `description` the
   * shared field, and everything else — `type` only when it is not the
   * default — rides the `pool:` section so it survives the round-trip.
   */
  toRulesyncSubagents(): RulesyncSubagent[] {
    return Object.entries(this.agents).map(([name, agent]) => {
      const { type, description, instructions, ...rest } = agent;
      const poolSection: Record<string, unknown> = {
        ...(type !== undefined && type !== DEFAULT_POOL_AGENT_TYPE ? { type } : {}),
        ...rest,
      };

      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["pool"],
        name,
        ...(description !== undefined ? { description } : {}),
        ...(Object.keys(poolSection).length > 0 ? { pool: poolSection } : {}),
      };

      return new RulesyncSubagent({
        outputRoot: process.cwd(),
        frontmatter: rulesyncFrontmatter,
        body: instructions ?? "",
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: `${sanitizePoolAgentFileStem(name)}.md`,
        validate: true,
      });
    });
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const subagents = this.toRulesyncSubagents();
    const first = subagents[0];
    if (!first) {
      throw new Error(
        `No custom subagents found in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())} to convert.`,
      );
    }
    return first;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "pool",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
    logger,
  }: ToolSubagentFromFileParams): Promise<PoolSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    const settings = parsePoolSettings(fileContent, filePath);

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      agents: agentsOfSettings({ settings, filePath, logger }),
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): PoolSubagent {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      agents: {},
      validate: false,
      global,
    });
  }
}
