import type { HookDefinition, HooksConfig } from "../types/hooks.js";

// ---------------------------------------------------------------------------
// MCP merge
// ---------------------------------------------------------------------------

type McpJson = {
  mcpServers: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Merge MCP JSON objects at the server-name level.
 * `base` entries take precedence over `overlay` entries with the same name.
 */
export function mergeMcpServers(base: McpJson, overlay: McpJson): McpJson {
  const mergedServers = { ...overlay.mcpServers, ...base.mcpServers };
  return { ...overlay, ...base, mcpServers: mergedServers };
}

// ---------------------------------------------------------------------------
// Hooks merge
// ---------------------------------------------------------------------------

/**
 * Merge hooks config objects.
 * For each event key, concatenates hook arrays (base hooks first, then overlay hooks).
 * Per-tool override sections are merged the same way.
 */
export function mergeHooks(base: HooksConfig, overlay: HooksConfig): HooksConfig {
  const result: HooksConfig = { ...base };

  // Merge the top-level hooks record
  result.hooks = mergeHookRecords(base.hooks, overlay.hooks);

  // Merge per-tool override sections
  const toolKeys = [
    "cursor",
    "claudecode",
    "copilot",
    "opencode",
    "factorydroid",
    "geminicli",
  ] as const;
  for (const tool of toolKeys) {
    const baseToolSection = base[tool];
    const overlayToolSection = overlay[tool];

    if (overlayToolSection?.hooks) {
      const baseToolHooks = baseToolSection?.hooks ?? {};
      result[tool] = {
        ...baseToolSection,
        hooks: mergeHookRecords(baseToolHooks, overlayToolSection.hooks),
      };
    }
  }

  return result;
}

/**
 * Merge two hook records. Base entries come first; overlay entries are appended.
 * For events present only in overlay, they are added as-is.
 */
function mergeHookRecords(
  base: Record<string, HookDefinition[]>,
  overlay: Record<string, HookDefinition[]>,
): Record<string, HookDefinition[]> {
  const result: Record<string, HookDefinition[]> = { ...base };

  for (const [event, hooks] of Object.entries(overlay)) {
    if (result[event]) {
      // Base hooks first, then overlay hooks
      result[event] = [...result[event], ...hooks];
    } else {
      result[event] = [...hooks];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Aiignore merge
// ---------------------------------------------------------------------------

/**
 * Merge .aiignore text content.
 * Concatenates lines (base first, then overlay), deduplicating identical non-empty lines.
 */
export function mergeAiignore(base: string, overlay: string): string {
  const baseLines = base.split("\n");
  const seen = new Set(baseLines.filter((line) => line.trim() !== ""));
  const newLines: string[] = [];

  for (const line of overlay.split("\n")) {
    if (line.trim() === "") continue;
    if (seen.has(line)) continue;
    seen.add(line);
    newLines.push(line);
  }

  if (newLines.length === 0) return base;

  // Ensure base ends with newline before appending
  const normalizedBase = base.endsWith("\n") ? base : base + "\n";
  return normalizedBase + newLines.join("\n") + "\n";
}
