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
export const PermissionRulesSchema = z.record(z.string(), PermissionActionSchema);
export type PermissionRules = z.infer<typeof PermissionRulesSchema>;

/**
 * Permissions configuration.
 * Keys are tool category names (e.g., "bash", "edit", "read", "webfetch").
 * Values are pattern-to-action mappings for that tool category.
 *
 * @example
 * {
 *   "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
 *   "edit": { "*": "deny", "src/**": "allow" }
 * }
 */
export const PermissionsConfigSchema = z.looseObject({
  permission: z.record(z.string(), PermissionRulesSchema),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

/**
 * Full permissions file schema including optional $schema field.
 */
export const RulesyncPermissionsFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...PermissionsConfigSchema.shape,
});
export type RulesyncPermissionsFile = z.infer<typeof RulesyncPermissionsFileSchema>;
