import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { INSTALL_MODES, installCommand } from "../lib/install.js";
import { CLIError, ErrorCodes } from "../types/json-output.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";
import { assertFileSourceWithinCwd, assertOptionalPathOptionWithinCwd } from "./path-options.js";

/**
 * Schema for install options
 * Excluded parameters:
 * - token: Secrets stay out of tool arguments; GITHUB_TOKEN / GH_TOKEN (and the
 *   tokenEnv npm variables) from the environment are used instead
 * - verbose/silent: Meaningless in MCP (no console output)
 */
export const installOptionsSchema = z.object({
  mode: z.optional(z.enum(INSTALL_MODES)),
  update: z.optional(z.boolean()),
  frozen: z.optional(z.boolean()),
  outdated: z.optional(z.boolean()),
  configPath: z.optional(z.string()),
});

export type InstallOptions = z.infer<typeof installOptionsSchema>;

/**
 * `install --outdated` reports stale or unresolvable sources by failing with
 * the reports attached; for an MCP caller that is a successful report.
 */
function recoverOutdatedReport({
  options,
  error,
}: {
  options: InstallOptions;
  error: unknown;
}): McpCommandResult | undefined {
  if (
    !options.outdated ||
    !(error instanceof CLIError) ||
    error.code !== ErrorCodes.INSTALL_FAILED ||
    typeof error.details !== "object" ||
    error.details === null ||
    !("sources" in error.details)
  ) {
    return undefined;
  }
  return {
    success: true,
    message: error.message,
    result: { sources: error.details.sources, upToDate: false },
  };
}

/**
 * Refuses a config whose sources the MCP server must not install, before
 * anything is installed:
 *
 * - a `file://` source outside the project, which would copy content from any
 *   local repository the operator can read into the project — the same
 *   containment MCP `add` enforces on its argument, applied here because a
 *   model can declare such a source through `mcp put` or a project file;
 * - in gh mode, a source declared with `scope: "user"`, which installs under
 *   the home directory, while the MCP server only writes inside the project.
 */
async function assertInstallableSources({
  configPath,
  mode,
}: {
  configPath: string | undefined;
  mode: InstallOptions["mode"];
}): Promise<void> {
  const config = await ConfigResolver.resolve({ configPath, verbose: false, silent: true });
  for (const source of config.getSources()) {
    await assertFileSourceWithinCwd(source.source);
  }
  if (mode !== "gh") {
    return;
  }
  const userScoped = config
    .getSources()
    .filter((source) => source.scope === "user")
    .map((source) => source.source);
  if (userScoped.length > 0) {
    throw new Error(
      `Sources with scope "user" install outside the project, which the MCP server does not do: ${userScoped.join(", ")}. Run 'rulesync install --mode gh' from the CLI instead.`,
    );
  }
}

/**
 * Execute the rulesync install command via MCP. With `outdated`, nothing is
 * written: the lockfile status of every source is reported in
 * `result.sources`, and `result.upToDate` says whether all are current.
 */
export async function executeInstall(options: InstallOptions = {}): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      await assertOptionalPathOptionWithinCwd({ path: options.configPath, label: "configPath" });
      await assertInstallableSources({ configPath: options.configPath, mode: options.mode });
      await installCommand(logger, { ...options, verbose: false, silent: true });
    },
    recover: ({ error }) => recoverOutdatedReport({ options, error }),
    ...(options.outdated ? { extraResult: { upToDate: true } } : {}),
  });
}

export const installTools = {
  executeInstall: {
    execute: async (options: InstallOptions = {}): Promise<string> =>
      stringifyResult(await executeInstall(options)),
  },
};
