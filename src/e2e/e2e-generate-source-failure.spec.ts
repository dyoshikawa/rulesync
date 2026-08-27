import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_CHECKS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

const SUCCESS_MARKER = "All files are up to date";

type RunFailure = { code?: number; stdout?: string; stderr?: string };

async function runGenerateExpectingFailure(params: {
  target: string;
  features: string;
  deleteFiles?: boolean;
}): Promise<RunFailure | undefined> {
  try {
    await runGenerate({ ...params, env: { NODE_ENV: "e2e" } });
    return undefined;
  } catch (error) {
    return error as RunFailure;
  }
}

/**
 * A `.rulesync/` source that fails to load writes nothing, which every counter
 * reports exactly like "there was nothing to write". These cases pin the
 * distinction to the exit code, so a scripted caller is never told the
 * generated configs are current when they were never written.
 */
describe("E2E: generate exit code for sources that fail to load", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    {
      feature: "mcp",
      target: "cursor",
      sourcePath: RULESYNC_MCP_RELATIVE_FILE_PATH,
      // `type` is constrained to a known transport list.
      content: JSON.stringify({
        mcpServers: { "test-server": { command: "echo", type: "bogus-transport" } },
      }),
      outputPath: join(".cursor", "mcp.json"),
    },
    {
      feature: "hooks",
      target: "claudecode",
      sourcePath: RULESYNC_HOOKS_RELATIVE_FILE_PATH,
      // Every hook event holds an array of matchers, not a string.
      content: JSON.stringify({ hooks: { PreToolUse: "not-an-array" } }),
      outputPath: join(".claude", "settings.json"),
    },
    {
      feature: "permissions",
      target: "cursor",
      sourcePath: RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
      // Actions are limited to allow / ask / deny.
      content: JSON.stringify({ permission: { bash: { "npm *": "maybe" } } }),
      outputPath: join(".cursor", "cli.json"),
    },
    {
      feature: "subagents",
      target: "claudecode",
      sourcePath: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "broken.md"),
      // `name` must be a string.
      content: "---\nname: 123\n---\n\nBody.\n",
      outputPath: join(".claude", "agents", "broken.md"),
    },
    {
      feature: "checks",
      target: "amp",
      sourcePath: join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, "broken.md"),
      // `severity` is limited to low / medium / high / critical.
      content: "---\nseverity: catastrophic\n---\n\nBody.\n",
      outputPath: join(".agents", "checks", "broken.md"),
    },
  ])(
    "should exit non-zero without reporting success when the $feature source fails validation",
    async ({ feature, target, sourcePath, content, outputPath }) => {
      const testDir = getTestDir();
      await writeFileContent(join(testDir, sourcePath), content);

      const failure = await runGenerateExpectingFailure({ target, features: feature });

      expect(failure?.code).toBe(1);
      expect(failure?.stderr).toContain("could not be loaded");
      // The run must not also claim the outputs are current.
      expect(failure?.stdout).not.toContain(SUCCESS_MARKER);
      expect(await fileExists(join(testDir, outputPath))).toBe(false);
    },
  );

  it.each([
    { feature: "mcp", target: "cursor" },
    { feature: "hooks", target: "claudecode" },
    { feature: "ignore", target: "cursor" },
    { feature: "permissions", target: "cursor" },
  ])(
    "should still succeed when the $feature source is simply absent",
    async ({ feature, target }) => {
      const testDir = getTestDir();
      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");

      const { stdout } = await runGenerate({
        target,
        features: feature,
        env: { NODE_ENV: "e2e" },
      });

      expect(stdout).toContain(SUCCESS_MARKER);
    },
  );

  it("should exit non-zero when the ignore source cannot be read", async () => {
    const testDir = getTestDir();
    // The ignore source is a plain pattern list, so it has no schema to
    // violate. A directory in its place is the portable way to make the read
    // itself fail — the point is that "exists but unreadable" is not success.
    await mkdir(join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH), { recursive: true });

    const failure = await runGenerateExpectingFailure({ target: "cursor", features: "ignore" });

    expect(failure?.code).toBe(1);
    expect(failure?.stdout).not.toContain(SUCCESS_MARKER);
    expect(await fileExists(join(testDir, ".cursorignore"))).toBe(false);
  });

  // Windows needs elevated rights to create symlinks, so this one is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "should exit non-zero when the source path cannot even be stat-ed",
    async () => {
      const testDir = getTestDir();
      const sourcePath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);
      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      // A self-referential symlink makes `stat` fail with ELOOP rather than
      // ENOENT. Treating that as "the file is absent" would silently generate
      // nothing and report success.
      await symlink(sourcePath, sourcePath);

      const failure = await runGenerateExpectingFailure({ target: "cursor", features: "mcp" });

      expect(failure?.code).toBe(1);
      expect(failure?.stdout).not.toContain(SUCCESS_MARKER);
    },
  );

  it("should keep already generated files when --delete runs after a load failure", async () => {
    const testDir = getTestDir();
    const outputPath = join(testDir, ".cursor", "mcp.json");
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({ mcpServers: { "test-server": { command: "echo" } } }),
    );

    await runGenerate({ target: "cursor", features: "mcp", env: { NODE_ENV: "e2e" } });
    expect(await fileExists(outputPath)).toBe(true);

    // The source now fails to load, so the run knows nothing about what it
    // should have produced. Sweeping on that would delete a working config the
    // run had no way to rewrite.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({ mcpServers: { "test-server": { command: "echo", type: "bogus" } } }),
    );

    const failure = await runGenerateExpectingFailure({
      target: "cursor",
      features: "mcp",
      deleteFiles: true,
    });

    expect(failure?.code).toBe(1);
    expect(await fileExists(outputPath)).toBe(true);
  });
});
