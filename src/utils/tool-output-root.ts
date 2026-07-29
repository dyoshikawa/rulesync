import type { ToolTarget } from "../types/tool-targets.js";
import { formatError } from "./error.js";
import { validateOutputRoot } from "./file.js";
import { resolveHermesagentOutputRoot } from "./hermesagent.js";
import { getKimiCodeHome } from "./kimi-code.js";

/** The environment variable each tool reads for its profile root. */
const TOOL_HOME_ENV_VARS: Partial<Record<ToolTarget, string>> = {
  hermesagent: "HERMES_HOME",
  "kimi-code": "KIMI_CODE_HOME",
};

/**
 * Substitute a tool's home override (`HERMES_HOME`, `KIMI_CODE_HOME`) for the
 * output root in global scope.
 *
 * The override wins over `--output-roots`: it names where the tool itself reads
 * its profile, so writing anywhere else would produce files the tool ignores.
 *
 * A substituted value goes through the same `validateOutputRoot` the CLI and
 * config paths use, so an override of `/` or an unnormalized path is rejected
 * instead of silently becoming the output root. The rejection is re-thrown
 * naming the variable, since the user never passed an `--output-roots` flag.
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
  if (resolved === outputRoot) return resolved;

  try {
    validateOutputRoot(resolved);
  } catch (error) {
    throw new Error(
      `${TOOL_HOME_ENV_VARS[toolTarget] ?? "The tool home override"} is not a usable output root: ${formatError(error)}`,
      { cause: error },
    );
  }
  return resolved;
}
