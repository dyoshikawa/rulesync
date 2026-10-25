import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { RulesyncPermissions } from "../features/permissions/rulesync-permissions.js";
import { createJsoncSourceFileTools } from "./jsonc-source-file-tools.js";

/**
 * Tool definitions for permissions-related operations
 */
export const permissionsTools = createJsoncSourceFileTools({
  toolNameSuffix: "Permissions",
  label: "permissions",
  sizeLabel: "Permissions",
  relativeFilePath: RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  source: RulesyncPermissions,
});
