import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { createJsoncSourceFileTools } from "./jsonc-source-file-tools.js";

/**
 * Tool definitions for hooks-related operations
 */
export const hooksTools = createJsoncSourceFileTools({
  toolNameSuffix: "Hooks",
  label: "hooks",
  sizeLabel: "Hooks",
  relativeFilePath: RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  source: RulesyncHooks,
});
