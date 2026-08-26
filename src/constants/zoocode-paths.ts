/**
 * Zoo Code is a VS Code extension, so its committable command allow/deny lists
 * are workspace settings rather than files in the `.roo/` agent-asset tree that
 * the other Zoo Code features write.
 *
 * `zoo-code.allowedCommands` / `zoo-code.deniedCommands` are contributed with no
 * `scope`, which in VS Code means `window` scope — settable in a workspace's
 * `.vscode/settings.json` — and `ClineProvider.mergeCommandLists()` unions the
 * workspace values into the effective auto-approval lists.
 *
 * Only the key names live here. The file location is shared with the archived
 * Roo lineage and comes from `roo-paths.ts`, since `ZoocodePermissions` extends
 * `RooPermissions`. The `zoo-code.*` namespace itself is Zoo-era (the v3.74.0
 * rebrand); the archived Roo Code lineage spelled the same settings
 * `roo-cline.*`, so the keys are deliberately not shared with the `roo` target,
 * which has its own pair in `roo-paths.ts`.
 *
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/package.json
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/core/webview/ClineProvider.ts
 */
export const ZOOCODE_ALLOWED_COMMANDS_KEY = "zoo-code.allowedCommands";
export const ZOOCODE_DENIED_COMMANDS_KEY = "zoo-code.deniedCommands";
