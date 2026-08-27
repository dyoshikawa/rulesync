import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
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
    expect(failure?.stderr).toContain("could not be loaded");
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

  // Windows needs elevated rights to create symlinks, so this one is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "should exit non-zero when the source is a symlink whose target is gone",
    async () => {
      const testDir = getTestDir();
      const sourcePath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);
      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      // The docs recommend symlinking `.rulesync/` sources at a shared tree, so
      // a link left pointing at a deleted target is a realistic state. `stat`
      // follows the link and reports ENOENT, which looks exactly like absence —
      // and reading that as "no source here" would silently generate nothing.
      await symlink(join(testDir, "shared", "mcp.jsonc"), sourcePath);

      const failure = await runGenerateExpectingFailure({ target: "cursor", features: "mcp" });

      expect(failure?.code).toBe(1);
      expect(failure?.stdout).not.toContain(SUCCESS_MARKER);
    },
  );

  // Windows needs elevated rights to create symlinks, so this one is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "should keep generated rules when the source directory symlink no longer resolves",
    async () => {
      const testDir = getTestDir();
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      const outputPath = join(testDir, ".claude", "rules", "ok.md");
      await writeFileContent(
        join(rulesDir, "ok.md"),
        [
          "---",
          'targets: ["*"]',
          'description: "ok"',
          'globs: ["**/*"]',
          "---",
          "",
          "ok rule",
        ].join("\n"),
      );

      await runGenerate({ target: "claudecode", features: "rules", env: { NODE_ENV: "e2e" } });
      expect(await fileExists(outputPath)).toBe(true);

      // A source tree shared by symlink is a documented layout, so a checkout
      // where that tree is missing is a real state. Globbing it yields nothing,
      // which is indistinguishable from "every rule was deleted" — and sweeping
      // on that would remove the rules this run could not regenerate.
      await rm(rulesDir, { recursive: true });
      await symlink(join(testDir, "shared-rules"), rulesDir);

      const failure = await runGenerateExpectingFailure({
        target: "claudecode",
        features: "rules",
        deleteFiles: true,
      });

      expect(failure?.code).toBe(1);
      expect(failure?.stdout).not.toContain(SUCCESS_MARKER);
      expect(await fileExists(outputPath)).toBe(true);
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
