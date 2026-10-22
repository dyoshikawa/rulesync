import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { INSTALL_MODES, installCommand } from "../lib/install.js";
import { CLIError, ErrorCodes } from "../types/json-output.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";
import { assertPathOptionWithinCwd } from "./path-options.js";

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
 * gh mode installs a source declared with `scope: "user"` under the home
 * directory. The MCP server only writes inside the project, so such a config
 * is refused before anything is installed.
 */
async function assertNoUserScopeSources({
  configPath,
}: {
  configPath: string | undefined;
}): Promise<void> {
  const config = await ConfigResolver.resolve({ configPath, verbose: false, silent: true });
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
      if (options.configPath !== undefined) {
        await assertPathOptionWithinCwd({ path: options.configPath, label: "configPath" });
      }
      if (options.mode === "gh") {
        await assertNoUserScopeSources({ configPath: options.configPath });
      }
      await installCommand(logger, { ...options, verbose: false, silent: true });
    },
    recover: ({ error }) => recoverOutdatedReport({ options, error }),
    ...(options.outdated ? { extraResult: { upToDate: true } } : {}),
  });
}

export const installTools = {
  executeInstall: {
    name: "executeInstall",
    description:
      "Execute the rulesync install command to install skills and rules from the sources declared in rulesync.jsonc (or apm.yml with mode 'apm'). With outdated: true it only reports which sources are behind the lockfile, without writing anything.",
    parameters: installOptionsSchema,
    execute: async (options: InstallOptions = {}): Promise<string> =>
      stringifyResult(await executeInstall(options)),
  },
};
