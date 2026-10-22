import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CONFIG_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { executeDoctor } from "./doctor.js";

type Diagnostic = { severity: string; code: string };

describe("executeDoctor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("passes and reports an info finding when there is no config", async () => {
    const result = await executeDoctor();

    expect(result.success).toBe(true);
    expect(result.result?.passed).toBe(true);
    const diagnostics = result.result?.diagnostics as Diagnostic[];
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: "info", code: "config/no-config-file" }),
    );
  });

  it("returns error findings as data instead of failing", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      JSON.stringify({ targets: ["not-a-tool"] }),
    );

    const result = await executeDoctor();

    expect(result.success).toBe(true);
    expect(result.result?.passed).toBe(false);
    expect(result.message).toContain("Doctor found problems");
    const diagnostics = result.result?.diagnostics as Diagnostic[];
    expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(result.result?.summary).toEqual(expect.objectContaining({ errors: expect.any(Number) }));
  });

  it("fails warnings under strict", async () => {
    await writeFileContent(
      join(testDir, "custom.jsonc"),
      JSON.stringify({ targets: ["claudecode"], features: ["rules", "ignore"] }),
    );

    const lenient = await executeDoctor({ configPath: "custom.jsonc" });
    const strict = await executeDoctor({ configPath: "custom.jsonc", strict: true });

    expect(lenient.result?.passed).toBe(true);
    expect(lenient.result?.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "config/deprecated-feature" }),
    );
    expect(strict.success).toBe(true);
    expect(strict.result?.passed).toBe(false);
  });

  it("rejects a config path outside the project", async () => {
    const result = await executeDoctor({ configPath: "../rulesync.jsonc" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("configPath must stay inside the project directory");
  });
});
