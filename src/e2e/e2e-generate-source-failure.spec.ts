import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

const SUCCESS_MARKER = "All files are up to date";

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

      let failure: { code?: number; stdout?: string; stderr?: string } | undefined;
      try {
        await runGenerate({ target, features: feature, env: { NODE_ENV: "e2e" } });
      } catch (error) {
        failure = error as { code?: number; stdout?: string; stderr?: string };
      }

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
});
