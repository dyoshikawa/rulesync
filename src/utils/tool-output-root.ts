import type { ToolTarget } from "../types/tool-targets.js";
import { resolveHermesagentOutputRoot } from "./hermesagent.js";
import { getKimiCodeHome } from "./kimi-code.js";

export function resolveToolOutputRoot({
  outputRoot,
  toolTarget,
  global,
}: {
  outputRoot: string;
  toolTarget: ToolTarget;
  global: boolean;
}): string {
  if (!global) return outputRoot;
  if (toolTarget === "hermesagent") {
    return resolveHermesagentOutputRoot({ outputRoot, global });
  }
  if (toolTarget === "kimi-code") {
    return getKimiCodeHome() ?? outputRoot;
  }
  return outputRoot;
}
