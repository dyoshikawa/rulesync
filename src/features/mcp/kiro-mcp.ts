import { join } from "node:path";

import { KIRO_MCP_FILE_NAME, KIRO_SETTINGS_DIR_PATH } from "../../constants/kiro-paths.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject, isStringArray } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * Union of two optional string lists, preserving order and dropping duplicates.
 * Returns `undefined` only when neither side was authored at all, so the caller
 * omits the key entirely rather than writing an empty array — but an explicitly
 * authored `[]` is kept, which keeps import → generate idempotent.
 */
function mergeToolLists(...lists: (readonly string[] | undefined)[]): string[] | undefined {
  if (lists.every((list) => list === undefined)) return undefined;

  const merged: string[] = [];
  for (const list of lists) {
    for (const tool of list ?? []) {
      if (!merged.includes(tool)) merged.push(tool);
    }
  }
  return merged;
}

/**
 * Translate rulesync's Kiro-only authoring keys onto the field names Kiro
 * actually reads in `mcp.json`.
 *
 * - `kiroAutoApprove` → `autoApprove` (tools run without a confirmation prompt)
 * - `kiroAutoBlock` → `disabledTools` (tools hidden from the agent)
 *
 * `disabledTools` is the only block list Kiro reads, and it is also a canonical
 * rulesync field, so `kiroAutoBlock` is a redundant spelling of it. Prefer the
 * canonical field; see the note on `kiroAutoBlock` in `src/types/mcp.ts`.
 *
 * Both native names are documented per-server fields, so a config that already
 * spells them natively keeps working: the two lists are merged rather than
 * one overwriting the other. That is the "merge" branch of the collision rule
 * documented on `enabledTools` in `src/types/mcp.ts` — it applies here because
 * the native names are redundant spellings of the same additive lists;
 * `copilotcli-mcp.ts` lets the canonical value win instead, and
 * `codexcli-mcp.ts` refuses the canonical value instead.
 * @see https://kiro.dev/docs/mcp/configuration/
 */
function toKiroMcpServers(servers: McpServers): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const { kiroAutoApprove, kiroAutoBlock, disabledTools, ...rest } = server;
      const autoApprove = mergeToolLists(
        isStringArray(rest.autoApprove) ? rest.autoApprove : undefined,
        kiroAutoApprove,
      );
      const disabled = mergeToolLists(disabledTools, kiroAutoBlock);

      return [
        name,
        {
          ...rest,
          ...(autoApprove !== undefined && { autoApprove }),
          ...(disabled !== undefined && { disabledTools: disabled }),
        },
      ];
    }),
  );
}

/**
 * Import direction of {@link toKiroMcpServers}: Kiro's `autoApprove` becomes the
 * rulesync-only `kiroAutoApprove` so a regenerate reproduces it. `disabledTools`
 * is left alone — it is already a canonical rulesync key with the same meaning,
 * so `kiroAutoBlock` deliberately has no import counterpart.
 *
 * Only a genuine string array is renamed. `kiroAutoApprove` is typed as one, so
 * moving a hand-written `"autoApprove": "all"` there would produce a
 * `.rulesync/mcp.jsonc` the next generate refuses to parse; such a value stays
 * under its original key and passes through untouched instead.
 */
function fromKiroMcpServers(servers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      if (server === null || typeof server !== "object" || Array.isArray(server)) {
        return [name, server];
      }
      const { autoApprove, ...rest } = server as Record<string, unknown>;
      if (!isStringArray(autoApprove)) return [name, server];

      return [name, { ...rest, kiroAutoApprove: autoApprove }];
    }),
  );
}

/**
 * Parse an existing user-level `~/.kiro/settings/mcp.json` so a global generate
 * can merge into it. An unparseable file is refused instead of overwritten:
 * it is unversioned, so replacing it would lose whatever the user had there.
 */
function parseExistingKiroMcpConfig(
  fileContent: string,
  configPath: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Kiro MCP config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Kiro MCP config at ${configPath}: expected a JSON object`);
  }
  return parsed;
}

export class KiroMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  /**
   * The user-level `~/.kiro/settings/mcp.json` also holds settings rulesync
   * does not manage (such as the top-level `identityProvider` block for
   * organization sign-in, which Kiro reads only from this file), so it is never
   * deleted in global mode. The project file is rulesync-managed and may be.
   * @see https://kiro.dev/docs/mcp/configuration/
   */
  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: KIRO_SETTINGS_DIR_PATH,
      relativeFilePath: KIRO_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<KiroMcp> {
    const paths = this.getSettablePaths();
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';

    return new KiroMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  /**
   * In global mode the generated `mcpServers` are merged into the existing
   * user-level file, keeping every other top-level key (for example
   * `identityProvider`). The project file is written from scratch.
   */
  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<KiroMcp> {
    const paths = this.getSettablePaths();
    const mcpServers = toKiroMcpServers(rulesyncMcp.getMcpServers());

    let existing: Record<string, unknown> = {};
    if (global) {
      const configPath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
      const existingContent = await readFileContentOrNull(configPath);
      if (existingContent !== null) {
        existing = parseExistingKiroMcpConfig(existingContent, configPath);
      }
    }

    return new KiroMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ ...existing, mcpServers }, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = this.json.mcpServers;
    const translated = isMcpServers(mcpServers)
      ? fromKiroMcpServers(mcpServers as Record<string, unknown>)
      : {};

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: translated }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): KiroMcp {
    return new KiroMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
