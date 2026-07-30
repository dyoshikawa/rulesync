// cspell:ignore cursorr -- deliberate typo used as a fixture
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_CONFIG_SCHEMA_URL } from "../constants/rulesync-paths.js";
import { writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

function runDoctor({
  json = false,
  strict = false,
}: { json?: boolean; strict?: boolean } = {}): Promise<{ stdout: string; stderr: string }> {
  const args = [
    ...rulesyncArgs,
    ...(json ? ["--json"] : []),
    "doctor",
    ...(strict ? ["--strict"] : []),
  ];
  return execFileAsync(rulesyncCmd, args, { env: { ...process.env, NODE_ENV: "e2e" } });
}

describe("E2E: doctor", () => {
  const { getTestDir } = useTestDirectory();

  it("exits 0 with no diagnostics on a clean configuration (happy path)", async () => {
    await writeFileContent(
      join(getTestDir(), "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode", "copilot"],
        features: ["rules", "mcp"],
      }),
    );

    const { stdout } = await runDoctor();

    expect(stdout).toContain("No problems found");
  });

  it("exits 0 when no configuration file exists", async () => {
    const { stdout } = await runDoctor();

    expect(stdout).toContain("config/no-config-file");
    expect(stdout).toContain("No problems found");
  });

  it("exits 1 and suggests a fix for a misspelled key", async () => {
    await writeFileContent(
      join(getTestDir(), "rulesync.jsonc"),
      JSON.stringify({ target: ["claudecode"] }),
    );

    await expect(runDoctor()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Did you mean 'targets'?"),
    });
  });

  it("exits 1 with --strict when only warnings are present", async () => {
    await writeFileContent(
      join(getTestDir(), "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        features: ["rules", "ignore"],
      }),
    );

    // Without --strict the deprecated-feature warning is not fatal.
    await runDoctor();
    await expect(runDoctor({ strict: true })).rejects.toMatchObject({ code: 1 });
  });

  it("emits structured diagnostics with --json on success", async () => {
    await writeFileContent(
      join(getTestDir(), "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        features: ["rules", "ignore"],
      }),
    );

    const { stdout } = await runDoctor({ json: true });

    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe("doctor");
    expect(parsed.data.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "config/deprecated-feature" })]),
    );
    expect(parsed.data.summary).toMatchObject({ errors: 0, warnings: 1 });
  });

  it("emits a structured error document with --json on failure", async () => {
    await writeFileContent(
      join(getTestDir(), "rulesync.jsonc"),
      JSON.stringify({ $schema: RULESYNC_CONFIG_SCHEMA_URL, targets: ["cursorr"] }),
    );

    const error = await runDoctor({ json: true }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 1 });
    const { stderr } = error as { stderr: string };
    const parsed = JSON.parse(stderr);
    expect(parsed.success).toBe(false);
    expect(parsed.command).toBe("doctor");
    expect(parsed.error).toMatchObject({ code: "DOCTOR_FAILED" });
    expect(parsed.error.details.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "config/unknown-target" })]),
    );
    expect(parsed.error.details.summary).toMatchObject({ errors: 1 });
  });
});
