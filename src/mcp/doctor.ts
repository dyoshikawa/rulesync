import { z } from "zod/mini";

import { doctorCommand } from "../lib/doctor.js";
import { CLIError, ErrorCodes } from "../types/json-output.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";
import { assertOptionalPathOptionWithinCwd } from "./path-options.js";

/**
 * Schema for doctor options
 * Excluded parameters:
 * - verbose/silent: Meaningless in MCP (no console output)
 */
export const doctorOptionsSchema = z.object({
  configPath: z.optional(z.string()),
  strict: z.optional(z.boolean()),
});

export type DoctorOptions = z.infer<typeof doctorOptionsSchema>;

/**
 * Execute the rulesync doctor command via MCP. `success` says the diagnosis
 * ran; `result.passed` says whether the configuration passed it (no errors,
 * and no warnings under `strict`). `result.diagnostics` lists every finding
 * with its severity, code, file and hint.
 */
export async function executeDoctor(options: DoctorOptions = {}): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      await assertOptionalPathOptionWithinCwd({ path: options.configPath, label: "configPath" });
      await doctorCommand(logger, {
        configPath: options.configPath,
        strict: options.strict,
        verbose: false,
        silent: true,
      });
    },
    recover: ({ error }) => {
      if (
        !(error instanceof CLIError) ||
        error.code !== ErrorCodes.DOCTOR_FAILED ||
        typeof error.details !== "object" ||
        error.details === null
      ) {
        return undefined;
      }
      return {
        success: true,
        message: error.message,
        result: { ...error.details, passed: false },
      };
    },
    extraResult: { passed: true },
  });
}

export const doctorTools = {
  executeDoctor: {
    name: "executeDoctor",
    description:
      "Execute the rulesync doctor command to diagnose the rulesync configuration (read-only). Returns the diagnostics (severity, code, file, message, hint) and whether the configuration passed.",
    parameters: doctorOptionsSchema,
    execute: async (options: DoctorOptions = {}): Promise<string> =>
      stringifyResult(await executeDoctor(options)),
  },
};
