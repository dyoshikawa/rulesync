import { z } from "zod/mini";

/**
 * Permission action values.
 * - allow: Automatically permitted without confirmation
 * - ask: Requires user confirmation before execution
 * - deny: Blocked from execution
 */
export const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

/**
 * Permission rules for a single tool category.
 * Keys are glob patterns matching tool input (commands, file paths, etc.).
 * Values are the permission action to apply when the pattern matches.
 *
 * @example
 * { "*": "ask", "git *": "allow", "rm *": "deny" }
 */
const PermissionRulesSchema = z.record(z.string(), PermissionActionSchema);

/**
 * OpenCode-specific permission value. Unlike the shared canonical block, which
 * only accepts a pattern-to-action map, OpenCode also allows a bare action
 * string that applies to the whole category (e.g. `"external_directory": "deny"`).
 * This mirrors OpenCode's own permission schema in `opencode-permissions.ts`.
 */
const OpencodeOverridePermissionValueSchema = z.union([
  PermissionActionSchema,
  PermissionRulesSchema,
]);

/**
 * Tool-scoped override block for OpenCode. Permission categories placed here
 * (e.g. OpenCode-only categories such as `external_directory`) are emitted only
 * into OpenCode's config and never leak into other tools' permission files. It
 * also lets a shared category be overridden with an OpenCode-specific value.
 * Kept `looseObject` so future OpenCode categories are accepted.
 *
 * @example
 * { "permission": { "external_directory": "deny", "webfetch": "allow" } }
 */
const OpencodePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(z.record(z.string(), OpencodeOverridePermissionValueSchema)),
});
export type OpencodePermissionsOverride = z.infer<typeof OpencodePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Hermes Agent. Keys placed here are deep-merged
 * into Hermes's `~/.hermes/config.yaml` and never leak into other tools' configs.
 * It carries Hermes-specific approval/security controls that have no canonical
 * permission category — e.g. `approvals` (`mode`, `cron_mode`, ...),
 * `security` (`allow_private_urls`, ...), `skills.write_approval`,
 * `memory.write_approval`. Kept `looseObject` (a verbatim passthrough) so any
 * current or future Hermes config key can be authored without modeling each one.
 *
 * @example
 * { "approvals": { "mode": "smart" }, "security": { "allow_private_urls": false } }
 */
const HermesPermissionsOverrideSchema = z.looseObject({});
export type HermesPermissionsOverride = z.infer<typeof HermesPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Cline. Cline's `command-permissions.json`
 * carries a single global `allowRedirects` boolean (gates shell redirection
 * operators `>`/`>>`/`<`) that has no per-command dimension and therefore no
 * canonical permission category. Placing it here lets users author it
 * declaratively; it is emitted only into Cline's config. Kept `looseObject` so
 * future Cline-only knobs can be added.
 *
 * @example
 * { "allowRedirects": true }
 */
const ClinePermissionsOverrideSchema = z.looseObject({
  allowRedirects: z.optional(z.boolean()),
});
export type ClinePermissionsOverride = z.infer<typeof ClinePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Kilo Code (an OpenCode fork). Kilo's permission
 * object is a free-form record with tool-specific keys that have no canonical
 * category — OpenCode-inherited ones (`external_directory`, `doom_loop`, `lsp`,
 * `question`, `todowrite`, `skill`, `task`, `list`) and Kilo-unique ones
 * (`agent_manager`, `notebook_read`, `notebook_edit`, `notebook_execute`,
 * `repo_clone`, `repo_overview`). Placing them here makes them authorable and
 * portable and keeps them out of other tools' configs. Mirrors the OpenCode
 * override; each value may be a bare action string or a pattern map.
 *
 * @example
 * { "permission": { "external_directory": "deny", "doom_loop": "ask" } }
 */
const KiloPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(z.record(z.string(), OpencodeOverridePermissionValueSchema)),
});
export type KiloPermissionsOverride = z.infer<typeof KiloPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Claude Code. Claude Code's `permissions` object
 * (in `.claude/settings.json`) carries non-list fields that have no canonical
 * permission category — `defaultMode` (the session-start permission mode) and
 * `additionalDirectories` (extra working directories) being the primary ones.
 * Fields placed under `claudecode.permissions` are merged into the settings
 * `permissions` object and emitted only for Claude Code, while the shared
 * `permission` block continues to drive the `allow`/`ask`/`deny` arrays. Kept a
 * `looseObject` passthrough so any current or future `permissions` field can be
 * authored without modeling each one; the managed `allow`/`ask`/`deny` arrays are
 * ignored here (rulesync owns them).
 *
 * @example
 * { "permissions": { "defaultMode": "acceptEdits", "additionalDirectories": ["../shared"] } }
 */
const ClaudecodePermissionsOverrideSchema = z.looseObject({
  permissions: z.optional(z.looseObject({})),
});
export type ClaudecodePermissionsOverride = z.infer<typeof ClaudecodePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Mistral Vibe. Vibe's per-tool `BaseToolConfig`
 * carries a `sensitive_patterns` list — patterns that escalate to ASK even when
 * the tool's base permission is ALWAYS (allow). The canonical model can only set
 * a pattern to a single `allow`/`ask`/`deny`, so an "allow by default but ask on
 * these patterns" escalation cannot be expressed. Entries under
 * `vibe.permission.<category>.sensitive_patterns` carry that list per canonical
 * category; the shared `permission` block still drives the base permission and
 * allow/deny lists. Keyed by canonical category (e.g. `bash`, `edit`).
 *
 * @example
 * { "permission": { "bash": { "sensitive_patterns": ["rm *", "sudo *"] } } }
 */
const VibePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(
    z.record(z.string(), z.looseObject({ sensitive_patterns: z.optional(z.array(z.string())) })),
  ),
});
export type VibePermissionsOverride = z.infer<typeof VibePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Cursor CLI. Cursor's `cli.json` carries scalar
 * autonomy settings with no canonical permission category — `approvalMode`
 * (`allowlist` | `auto-review` | `unrestricted`) and a `sandbox` object
 * (`mode`/`networkAccess`). Fields placed here are merged into the top-level of
 * `.cursor/cli.json` (project) / `~/.cursor/cli-config.json` (global) and emitted
 * only for Cursor, while the shared `permission` block continues to drive the
 * `permissions.allow`/`permissions.deny` arrays. Kept a `looseObject` so extra
 * `cli.json` keys can be authored (they are merged verbatim on generate);
 * `sandbox`'s accepted values are not documented so it passes through verbatim.
 * Note: only `approvalMode` and `sandbox` round-trip back on import — other keys
 * authored here reach `cli.json` on generate but are not re-extracted.
 *
 * @example
 * { "approvalMode": "auto-review" }
 */
const CursorPermissionsOverrideSchema = z.looseObject({
  approvalMode: z.optional(z.string()),
  sandbox: z.optional(z.looseObject({})),
});
export type CursorPermissionsOverride = z.infer<typeof CursorPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Qwen Code. Qwen's `settings.json` exposes
 * autonomy/sandbox controls with no canonical permission category — under
 * `tools` (`approvalMode` = plan/default/auto-edit/auto/yolo, `autoAccept`,
 * `sandbox`, `sandboxImage`, `disabled`) and `security` (`folderTrust`). Fields
 * placed here are merged into the matching `settings.json` group and emitted
 * only for Qwen, while the shared `permission` block continues to drive the
 * `permissions.allow`/`ask`/`deny` arrays. Kept `looseObject` (verbatim
 * passthrough) so any current or future `tools`/`security` key can be authored.
 *
 * @example
 * { "tools": { "approvalMode": "auto-edit" }, "security": { "folderTrust": { "enabled": true } } }
 */
const QwencodePermissionsOverrideSchema = z.looseObject({
  tools: z.optional(z.looseObject({})),
  security: z.optional(z.looseObject({})),
});
export type QwencodePermissionsOverride = z.infer<typeof QwencodePermissionsOverrideSchema>;

/**
 * Permissions configuration.
 * Keys are tool category names (e.g., "bash", "edit", "read", "webfetch").
 * Values are pattern-to-action mappings for that tool category.
 *
 * The optional `opencode`/`hermes`/`cline`/`kilo`/`claudecode`/`vibe`/`cursor`/
 * `qwencode` keys are tool-scoped overrides consumed only by their respective
 * translator (see the matching `*PermissionsOverrideSchema`); every other tool
 * reads the shared `permission` block and ignores them.
 *
 * @example
 * {
 *   "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
 *   "edit": { "*": "deny", "src/**": "allow" }
 * }
 */
const PermissionsConfigSchema = z.looseObject({
  permission: z.record(z.string(), PermissionRulesSchema),
  opencode: z.optional(OpencodePermissionsOverrideSchema),
  hermes: z.optional(HermesPermissionsOverrideSchema),
  cline: z.optional(ClinePermissionsOverrideSchema),
  kilo: z.optional(KiloPermissionsOverrideSchema),
  claudecode: z.optional(ClaudecodePermissionsOverrideSchema),
  vibe: z.optional(VibePermissionsOverrideSchema),
  cursor: z.optional(CursorPermissionsOverrideSchema),
  qwencode: z.optional(QwencodePermissionsOverrideSchema),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

/**
 * Full permissions file schema including optional $schema field.
 */
export const RulesyncPermissionsFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...PermissionsConfigSchema.shape,
});
