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
 * Permissions configuration.
 * Keys are tool category names (e.g., "bash", "edit", "read", "webfetch").
 * Values are pattern-to-action mappings for that tool category.
 *
 * The optional `opencode`/`hermes`/`cline` keys are tool-scoped overrides
 * consumed only by their respective translator (see the matching
 * `*PermissionsOverrideSchema`); every other tool reads the shared `permission`
 * block and ignores them.
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
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

/**
 * Full permissions file schema including optional $schema field.
 */
export const RulesyncPermissionsFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...PermissionsConfigSchema.shape,
});
