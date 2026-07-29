import type { ToolTarget } from "../types/tool-targets.js";
import { validateOutputRoot } from "./file.js";
import { resolveHermesagentOutputRoot } from "./hermesagent.js";
import { getKimiCodeHome } from "./kimi-code.js";

/**
 * Substitute a tool's home override (`HERMES_HOME`, `KIMI_CODE_HOME`) for the
 * output root in global scope.
 *
 * The override wins over `--output-roots`: it names where the tool itself reads
 * its profile, so writing anywhere else would produce files the tool ignores.
 *
 * The substituted value goes through the same `validateOutputRoot` the CLI and
 * config paths use, so an override of `/` or an unnormalized path is rejected
 * instead of silently becoming the output root.
 */
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
  const resolved =
    toolTarget === "hermesagent"
      ? resolveHermesagentOutputRoot({ outputRoot, global })
      : toolTarget === "kimi-code"
        ? (getKimiCodeHome() ?? outputRoot)
        : outputRoot;
  if (resolved !== outputRoot) {
    validateOutputRoot(resolved);
  }
  return resolved;
}
