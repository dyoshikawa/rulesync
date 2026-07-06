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
 * Permissions configuration.
 * Keys are tool category names (e.g., "bash", "edit", "read", "webfetch").
 * Values are pattern-to-action mappings for that tool category.
 *
 * The optional `opencode` key is a tool-scoped override that is consumed only by
 * the OpenCode translator (see `OpencodePermissionsOverrideSchema`); every other
 * tool reads the shared `permission` block and ignores it.
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
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

/**
 * Full permissions file schema including optional $schema field.
 */
export const RulesyncPermissionsFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...PermissionsConfigSchema.shape,
});
