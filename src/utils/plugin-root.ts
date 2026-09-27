import type { ToolTarget } from "../types/tool-targets.js";
import { PACKAGING_TOOL_TARGETS } from "../types/tool-targets.js";
import { assertDirectoryIfExists, assertTreeContainsNoSymlinks, directoryExists } from "./file.js";

export function isPackagingToolTarget(toolTarget: ToolTarget): boolean {
  return PACKAGING_TOOL_TARGETS.includes(toolTarget as (typeof PACKAGING_TOOL_TARGETS)[number]);
}

/**
 * Packaging targets write into a plugin directory and support project scope
 * only. In global mode their output root would be the home directory, so
 * callers reject or skip them up front instead of checking all of $HOME.
 */
export function formatPackagingTargetGlobalMessage(toolTarget: ToolTarget): string {
  return `Target '${toolTarget}' is a plugin packaging target and supports only project scope. Re-run without '--global'.`;
}

export async function assertPluginRootSafe(params: {
  toolTarget: ToolTarget;
  outputRoot: string;
}): Promise<void> {
  if (!isPackagingToolTarget(params.toolTarget)) {
    return;
  }

  await assertDirectoryIfExists(params.outputRoot);
  if (!(await directoryExists(params.outputRoot))) {
    throw new Error(`Plugin output root must be an existing directory: ${params.outputRoot}.`);
  }
  await assertTreeContainsNoSymlinks(params.outputRoot);
}
