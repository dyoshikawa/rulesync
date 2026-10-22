import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { executeAdd } from "./add.js";

describe("executeAdd", () => {
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

  it("scaffolds a feature file and reports it", async () => {
    const result = await executeAdd({ source: "rule", name: "my-rule" });

    expect(result.success).toBe(true);
    const created = result.result?.created as string[];
    expect(created).toHaveLength(1);
    expect(created[0]).toContain("my-rule");
    expect(await readFileContent(join(testDir, created[0] ?? ""))).not.toBe("");
  });

  it("refuses to overwrite an existing scaffold without force", async () => {
    const first = await executeAdd({ source: "rule", name: "my-rule" });
    const created = first.result?.created as string[];
    const path = join(testDir, created[0] ?? "");
    await writeFileContent(path, "kept\n");

    const second = await executeAdd({ source: "rule", name: "my-rule" });
    expect(second.success).toBe(false);
    expect(second.error).toContain("--force");
    expect(await readFileContent(path)).toBe("kept\n");

    const forced = await executeAdd({ source: "rule", name: "my-rule", force: true });
    expect(forced.success).toBe(true);
    expect(await readFileContent(path)).not.toBe("kept\n");
  });

  it("rejects a config path outside the project", async () => {
    const result = await executeAdd({ source: "owner/repo", configPath: "../rulesync.jsonc" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("configPath must stay inside the project directory");
  });

  it("requires a source", async () => {
    const result = await executeAdd({ source: "" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("source is required");
  });

  it("fails when the config file does not exist", async () => {
    const result = await executeAdd({ source: "owner/repo" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Configuration file not found");
  });
});
