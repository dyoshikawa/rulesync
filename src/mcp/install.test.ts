import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CONFIG_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { checkOutdatedSources } from "../lib/sources-outdated.js";
import { resolveAndFetchSources } from "../lib/sources.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { executeInstall } from "./install.js";

vi.mock("../lib/sources.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/sources.js")>("../lib/sources.js");
  return { ...actual, resolveAndFetchSources: vi.fn() };
});
vi.mock("../lib/sources-outdated.js");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("executeInstall", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      JSON.stringify({ sources: [{ source: "owner/repo" }] }),
    );
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.mocked(resolveAndFetchSources).mockReset();
    vi.mocked(checkOutdatedSources).mockReset();
  });

  it("installs the declared sources and reports the counts", async () => {
    vi.mocked(resolveAndFetchSources).mockResolvedValue({
      fetchedSkillCount: 2,
      fetchedRuleCount: 1,
      sourcesProcessed: 1,
      failedSourceCount: 0,
    });

    const result = await executeInstall({ update: true });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      sourcesProcessed: 1,
      skillsFetched: 2,
      rulesFetched: 1,
      failedSourceCount: 0,
    });
    expect(vi.mocked(resolveAndFetchSources).mock.calls[0]?.[0].options).toEqual({
      updateSources: true,
      frozen: undefined,
      token: undefined,
    });
  });

  it("reports outdated sources instead of failing", async () => {
    vi.mocked(checkOutdatedSources).mockResolvedValue([
      {
        source: "owner/repo",
        transport: "github",
        status: "outdated",
        requestedRef: "main",
        lockedRef: SHA_A,
        latestRef: SHA_B,
      },
    ]);

    const result = await executeInstall({ outdated: true });

    expect(result.success).toBe(true);
    expect(result.result?.upToDate).toBe(false);
    expect(result.result?.sources).toEqual([expect.objectContaining({ status: "outdated" })]);
    expect(result.message).toContain("behind");
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("reports up-to-date sources", async () => {
    vi.mocked(checkOutdatedSources).mockResolvedValue([
      {
        source: "owner/repo",
        transport: "github",
        status: "up-to-date",
        requestedRef: "main",
        lockedRef: SHA_A,
        latestRef: SHA_A,
      },
    ]);

    const result = await executeInstall({ outdated: true });

    expect(result.success).toBe(true);
    expect(result.result?.upToDate).toBe(true);
  });

  it("fails invalid combinations", async () => {
    const result = await executeInstall({ outdated: true, update: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("--outdated cannot be combined");
  });

  it("refuses gh sources that install at user scope", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      JSON.stringify({ sources: [{ source: "owner/repo", scope: "user" }] }),
    );

    const result = await executeInstall({ mode: "gh" });

    expect(result.success).toBe(false);
    expect(result.error).toContain('scope "user"');
  });

  it("rejects a config path outside the project", async () => {
    const result = await executeInstall({ configPath: "../rulesync.jsonc" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("configPath must stay inside the project directory");
  });
});
