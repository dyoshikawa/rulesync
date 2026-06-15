import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { ClaudecodeIgnore } from "../features/ignore/claudecode-ignore.js";
import { RulesyncIgnore } from "../features/ignore/rulesync-ignore.js";
import { KiloMcp } from "../features/mcp/kilo-mcp.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { ClaudecodePermissions } from "../features/permissions/claudecode-permissions.js";
import { RulesyncPermissions } from "../features/permissions/rulesync-permissions.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../utils/file.js";

/**
 * Integration regression tests for the execution-order constraints documented in
 * `generate.ts`. Unlike the orchestration-order tests in `generate.test.ts` —
 * which mock the processors and only assert `invocationCallOrder` — these tests
 * exercise the *real* tool-file read-modify-write logic against a temp dir, so
 * they actually fail if a writer drops the other feature's data from the shared
 * file. They are the genuine data-loss guards the order tests stand in for.
 */
describe("shared output file data-loss regressions", () => {
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

  describe(".claude/settings.json (ignore before permissions)", () => {
    it("preserves ignore-written Read deny entries when permissions writes afterward", async () => {
      // 1. ignore feature writes its Read(...) deny entries to settings.json.
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: ".env\nsecrets/**",
      });
      const ignore = await ClaudecodeIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore,
        options: {},
      });
      await writeFileContent(ignore.getFilePath(), ignore.getFileContent());

      // 2. permissions feature reads that same settings.json and merges in its
      //    own (Bash) entries. "Read" is NOT managed by this config, so the
      //    ignore-written Read deny entries must survive.
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "rm *": "deny" },
          },
        }),
      });
      const permissions = await ClaudecodePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });
      await writeFileContent(permissions.getFilePath(), permissions.getFileContent());

      // 3. The on-disk file must contain BOTH features' data.
      const finalContent = await readFileContent(join(testDir, ".claude", "settings.json"));
      const settings = JSON.parse(finalContent);
      expect(settings.permissions.deny).toContain("Read(.env)");
      expect(settings.permissions.deny).toContain("Read(secrets/**)");
      expect(settings.permissions.deny).toContain("Bash(rm *)");
    });
  });

  describe("kilo.jsonc (mcp before rules)", () => {
    it("preserves the mcp/tools block when rules registers instructions afterward", async () => {
      // 1. mcp feature writes the `mcp` block to kilo.jsonc.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "node",
              args: ["server.js"],
            },
          },
        }),
      });
      const mcp = await KiloMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      await writeFileContent(mcp.getFilePath(), mcp.getFileContent());

      // 2. rules feature registers non-root rules in the `instructions` key of the
      //    same kilo.jsonc. This read-modify-write must preserve the mcp block.
      const rules = await KiloMcp.fromInstructions({
        outputRoot: testDir,
        instructions: [join(".kilo", "rules", "coding.md")],
      });
      await writeFileContent(rules.getFilePath(), rules.getFileContent());

      // 3. The on-disk file must contain BOTH the mcp block and the instructions.
      const finalContent = await readFileContent(join(testDir, "kilo.jsonc"));
      const kilo = JSON.parse(finalContent);
      expect(kilo.mcp).toBeDefined();
      expect(kilo.mcp["test-server"]).toBeDefined();
      expect(kilo.instructions).toContain(join(".kilo", "rules", "coding.md"));
    });
  });
});
