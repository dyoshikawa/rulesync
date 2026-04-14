import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { resolveGitignoreTargets } from "./resolve-gitignore-targets.js";

describe("resolveGitignoreTargets", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(resolve(testDir));
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("returns CLI targets verbatim when provided", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({ targets: ["claudecode"], gitignoreTargetsOnly: true }),
    );

    const result = await resolveGitignoreTargets({ cliTargets: ["cursor"] });

    expect(result).toEqual(["cursor"]);
  });

  it("returns undefined when no config file exists (emit all tools)", async () => {
    const result = await resolveGitignoreTargets({ cliTargets: undefined });

    expect(result).toBeUndefined();
  });

  it("returns config targets when gitignoreTargetsOnly is true (default)", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({ targets: ["claudecode", "copilot"] }),
    );

    const result = await resolveGitignoreTargets({ cliTargets: undefined });

    expect(result).toEqual(["claudecode", "copilot"]);
  });

  it("returns undefined when gitignoreTargetsOnly is explicitly false", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        targets: ["claudecode"],
        gitignoreTargetsOnly: false,
      }),
    );

    const result = await resolveGitignoreTargets({ cliTargets: undefined });

    expect(result).toBeUndefined();
  });

  it("applies gitignoreTargetsOnly when only rulesync.local.jsonc exists", async () => {
    await writeFileContent(
      join(testDir, "rulesync.local.jsonc"),
      JSON.stringify({ targets: ["cursor"] }),
    );

    const result = await resolveGitignoreTargets({ cliTargets: undefined });

    expect(result).toEqual(["cursor"]);
  });
});
