import { uniq } from "es-toolkit";

import type { ClaudeSettingsJson } from "../types/claude-settings.js";
import type { Logger } from "../utils/logger.js";

/**
 * Single owner of the `.claude/settings.json` `permissions` block, which both
 * `ignore` (writes `Read(...)` into `permissions.deny`) and `permissions`
 * (writes the whole `allow`/`ask`/`deny`) read-modify-write. The entry format,
 * the merge, and the cross-feature ownership rule (permissions' explicit `Read`
 * rules win over ignore-derived `Read` denies) used to be duplicated across both
 * feature files; they live here once so each feature just states its intent and
 * never reasons about the other's existence.
 */

const READ_TOOL_NAME = "Read";

export const isReadDenyEntry = (entry: string): boolean =>
  entry.startsWith(`${READ_TOOL_NAME}(`) && entry.endsWith(")");

export const buildReadDenyEntry = (pattern: string): string => `${READ_TOOL_NAME}(${pattern})`;

const parsePermissionsBlock = (
  settings: ClaudeSettingsJson,
): { allow: string[]; ask: string[]; deny: string[] } => {
  const permissions = settings.permissions ?? {};
  return {
    allow: permissions.allow ?? [],
    ask: permissions.ask ?? [],
    deny: permissions.deny ?? [],
  };
};

// Empty arrays are omitted so the file never carries an empty allow/ask/deny key.
// Other top-level keys (e.g. `hooks`) and other keys under `permissions` are kept.
const withPermissions = (
  settings: ClaudeSettingsJson,
  next: { allow: string[]; ask: string[]; deny: string[] },
): ClaudeSettingsJson => {
  const permissions: Record<string, unknown> = { ...settings.permissions };
  const assign = (key: "allow" | "ask" | "deny", values: string[]): void => {
    if (values.length > 0) {
      permissions[key] = values;
    } else {
      delete permissions[key];
    }
  };
  assign("allow", next.allow);
  assign("ask", next.ask);
  assign("deny", next.deny);
  return { ...settings, permissions };
};

// Non-`Read` deny entries belong to the permissions feature and are preserved;
// `Read(...)` denies are replaced wholesale since the ignore source owns them.
export const applyIgnoreReadDenies = (params: {
  settings: ClaudeSettingsJson;
  readDenies: string[];
}): ClaudeSettingsJson => {
  const { settings, readDenies } = params;
  const current = parsePermissionsBlock(settings);
  const preservedDeny = current.deny.filter(
    (entry) => !isReadDenyEntry(entry) || readDenies.includes(entry),
  );
  return withPermissions(settings, {
    allow: current.allow,
    ask: current.ask,
    deny: uniq([...preservedDeny, ...readDenies].toSorted()),
  });
};

// Entries for managed tools are replaced; entries for unmanaged tools are kept.
// When `Read` is managed, permissions' rules win over ignore-derived `Read(...)`
// denies — those are overwritten, and the overwrite is warned about if a logger
// is given.
export const applyPermissions = (params: {
  settings: ClaudeSettingsJson;
  managedToolNames: ReadonlySet<string>;
  toolNameOf: (entry: string) => string;
  allow: string[];
  ask: string[];
  deny: string[];
  logger?: Logger | undefined;
}): ClaudeSettingsJson => {
  const { settings, managedToolNames, toolNameOf, allow, ask, deny, logger } = params;
  const current = parsePermissionsBlock(settings);

  const keepUnmanaged = (entries: string[]): string[] =>
    entries.filter((entry) => !managedToolNames.has(toolNameOf(entry)));

  if (logger && managedToolNames.has(READ_TOOL_NAME)) {
    const overwrittenReadDenies = current.deny.filter(
      (entry) => toolNameOf(entry) === READ_TOOL_NAME,
    );
    if (overwrittenReadDenies.length > 0) {
      logger.warn(
        `Permissions feature manages '${READ_TOOL_NAME}' tool and will overwrite ` +
          `${overwrittenReadDenies.length} existing ${READ_TOOL_NAME} deny entries. ` +
          `Permissions take precedence.`,
      );
    }
  }

  return withPermissions(settings, {
    allow: uniq([...keepUnmanaged(current.allow), ...allow].toSorted()),
    ask: uniq([...keepUnmanaged(current.ask), ...ask].toSorted()),
    deny: uniq([...keepUnmanaged(current.deny), ...deny].toSorted()),
  });
};
