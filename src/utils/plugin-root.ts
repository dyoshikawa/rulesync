import type { ToolTarget } from "../types/tool-targets.js";
import { PACKAGING_TOOL_TARGETS } from "../types/tool-targets.js";
import { assertDirectoryIfExists, assertTreeContainsNoSymlinks, directoryExists } from "./file.js";

export function isPackagingToolTarget(toolTarget: ToolTarget): boolean {
  return PACKAGING_TOOL_TARGETS.includes(toolTarget as (typeof PACKAGING_TOOL_TARGETS)[number]);
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
