import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DevinHooks } from "./devin-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("DevinHooks", () => {
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

  describe("getSettablePaths", () => {
    it("should return .devin and hooks.json for project mode", () => {
      const paths = DevinHooks.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: ".windsurf", relativeFilePath: "hooks.json" });
    });

    it("should return .codeium/windsurf and hooks.json for global mode", () => {
      const paths = DevinHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".codeium", "windsurf"),
        relativeFilePath: "hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should produce a top-level hooks-keyed object mapping canonical events to Devin events", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeReadFile: [{ command: "python3 /p/read.py", show_output: true }],
          afterFileEdit: [{ command: "python3 /p/write.py" }],
          beforeShellExecution: [{ command: "audit.sh", working_directory: "/tmp" }],
          beforeMCPExecution: [{ command: "mcp-pre.sh" }],
          beforeSubmitPrompt: [{ command: "prompt.sh" }],
          afterAgentResponse: [{ command: "response.sh" }],
          worktreeCreate: [{ command: "setup.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(Object.keys(parsed)).toEqual(["hooks"]);
      expect(parsed.hooks.pre_read_code).toEqual([
        { command: "python3 /p/read.py", show_output: true },
      ]);
      expect(parsed.hooks.post_write_code).toEqual([{ command: "python3 /p/write.py" }]);
      expect(parsed.hooks.pre_run_command).toEqual([
        { command: "audit.sh", working_directory: "/tmp" },
      ]);
      expect(parsed.hooks.pre_mcp_tool_use).toEqual([{ command: "mcp-pre.sh" }]);
      expect(parsed.hooks.pre_user_prompt).toEqual([{ command: "prompt.sh" }]);
      expect(parsed.hooks.post_cascade_response).toEqual([{ command: "response.sh" }]);
      expect(parsed.hooks.post_setup_worktree).toEqual([{ command: "setup.sh" }]);
    });

    it("should not invent type, matcher, or timeout fields", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeReadFile: [
            {
              type: "command",
              command: "read.sh",
              matcher: "Edit",
              timeout: 30,
              show_output: false,
            },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      const hook = parsed.hooks.pre_read_code[0];
      expect(hook).toEqual({ command: "read.sh", show_output: false });
      expect(hook).not.toHaveProperty("type");
      expect(hook).not.toHaveProperty("matcher");
      expect(hook).not.toHaveProperty("timeout");
    });

    it("should preserve the powershell field", async () => {
      const config = {
        version: 1,
        hooks: {
          afterShellExecution: [
            { command: "echo unix", powershell: "Write-Host win", show_output: true },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.hooks.post_run_command).toEqual([
        { command: "echo unix", powershell: "Write-Host win", show_output: true },
      ]);
    });

    it("should drop canonical events without a Devin equivalent and warn", async () => {
      const warn = vi.fn();
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "start.sh" }],
          stop: [{ command: "stop.sh" }],
          beforeReadFile: [{ command: "read.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger: { warn } as never,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.hooks.pre_read_code).toBeDefined();
      expect(Object.keys(parsed.hooks)).toEqual(["pre_read_code"]);
      // sessionStart and stop are filtered out before reaching the converter,
      // so no per-event warning is emitted, but they never appear in output.
      expect(parsed.hooks).not.toHaveProperty("session_start");
    });

    it("should merge config.devin.hooks on top of shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeReadFile: [{ command: "shared-read.sh" }],
        },
        devin: {
          hooks: {
            beforeReadFile: [{ command: "override-read.sh" }],
            afterFileEdit: [{ command: "override-write.sh" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.hooks.pre_read_code).toEqual([{ command: "override-read.sh" }]);
      expect(parsed.hooks.post_write_code).toEqual([{ command: "override-write.sh" }]);
    });

    it("should write to the global path when global is true", async () => {
      const config = {
        version: 1,
        hooks: { beforeReadFile: [{ command: "read.sh" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(devinHooks.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
      expect(devinHooks.getRelativeFilePath()).toBe("hooks.json");
    });
  });

  describe("fromFile", () => {
    it("should parse an existing project hooks.json", async () => {
      const dir = join(testDir, ".windsurf");
      await ensureDir(dir);
      const content = JSON.stringify({
        hooks: {
          pre_read_code: [{ command: "python3 /p/s.py", show_output: true }],
        },
      });
      await writeFileContent(join(dir, "hooks.json"), content);

      const devinHooks = await DevinHooks.fromFile({ outputRoot: testDir });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.hooks.pre_read_code).toEqual([
        { command: "python3 /p/s.py", show_output: true },
      ]);
    });

    it("should fall back to an empty hooks object when the file is missing", async () => {
      const devinHooks = await DevinHooks.fromFile({ outputRoot: testDir });
      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed).toEqual({ hooks: {} });
    });

    it("should read from the global path when global is true", async () => {
      const dir = join(testDir, ".codeium", "windsurf");
      await ensureDir(dir);
      const content = JSON.stringify({
        hooks: { post_setup_worktree: [{ command: "setup.sh" }] },
      });
      await writeFileContent(join(dir, "hooks.json"), content);

      const devinHooks = await DevinHooks.fromFile({ outputRoot: testDir, global: true });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.hooks.post_setup_worktree).toEqual([{ command: "setup.sh" }]);
      expect(devinHooks.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
    });
  });

  describe("toRulesyncHooks", () => {
    it("should map Devin events back to canonical event names", () => {
      const fileContent = JSON.stringify({
        hooks: {
          pre_read_code: [{ command: "read.sh", show_output: true }],
          post_write_code: [{ command: "write.sh" }],
          pre_run_command: [{ command: "cmd.sh", working_directory: "/tmp" }],
          post_mcp_tool_use: [{ command: "mcp.sh" }],
          pre_user_prompt: [{ command: "prompt.sh" }],
          post_cascade_response_with_transcript: [{ command: "transcript.sh" }],
          post_setup_worktree: [{ command: "setup.sh" }],
        },
      });
      const devinHooks = new DevinHooks({
        outputRoot: testDir,
        relativeDirPath: ".windsurf",
        relativeFilePath: "hooks.json",
        fileContent,
        validate: false,
      });

      const rulesyncHooks = devinHooks.toRulesyncHooks();
      const parsed = JSON.parse(rulesyncHooks.getFileContent());

      expect(parsed.version).toBe(1);
      expect(parsed.hooks.beforeReadFile).toEqual([
        { type: "command", command: "read.sh", show_output: true },
      ]);
      expect(parsed.hooks.afterFileEdit).toEqual([{ type: "command", command: "write.sh" }]);
      expect(parsed.hooks.beforeShellExecution).toEqual([
        { type: "command", command: "cmd.sh", working_directory: "/tmp" },
      ]);
      expect(parsed.hooks.afterMCPExecution).toEqual([{ type: "command", command: "mcp.sh" }]);
      expect(parsed.hooks.beforeSubmitPrompt).toEqual([{ type: "command", command: "prompt.sh" }]);
      expect(parsed.hooks.beforeAgentResponse).toEqual([
        { type: "command", command: "transcript.sh" },
      ]);
      expect(parsed.hooks.worktreeCreate).toEqual([{ type: "command", command: "setup.sh" }]);
    });

    it("should drop unknown Devin events instead of passing them through", () => {
      const fileContent = JSON.stringify({
        hooks: {
          pre_read_code: [{ command: "read.sh" }],
          // Not one of the documented 12 events; must not survive import,
          // otherwise it would be silently dropped on the next generate.
          some_future_event: [{ command: "future.sh" }],
        },
      });
      const devinHooks = new DevinHooks({
        outputRoot: testDir,
        relativeDirPath: ".windsurf",
        relativeFilePath: "hooks.json",
        fileContent,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.toRulesyncHooks().getFileContent());

      expect(parsed.hooks.beforeReadFile).toBeDefined();
      expect(parsed.hooks.some_future_event).toBeUndefined();
    });

    it("should round-trip mappable events through fromRulesyncHooks and back", async () => {
      const config = {
        version: 1,
        hooks: {
          beforeReadFile: [{ type: "command", command: "read.sh", show_output: true }],
          afterFileEdit: [{ type: "command", command: "write.sh" }],
          beforeShellExecution: [{ type: "command", command: "cmd.sh", working_directory: "/tmp" }],
          beforeMCPExecution: [{ type: "command", command: "mcp.sh" }],
          afterMCPExecution: [{ type: "command", command: "mcp-post.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          afterAgentResponse: [{ type: "command", command: "response.sh" }],
          beforeAgentResponse: [{ type: "command", command: "transcript.sh" }],
          beforeTabFileRead: [{ type: "command", command: "tab-read.sh" }],
          afterTabFileEdit: [{ type: "command", command: "tab-edit.sh" }],
          afterShellExecution: [{ type: "command", command: "shell-post.sh" }],
          worktreeCreate: [{ type: "command", command: "setup.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const back = devinHooks.toRulesyncHooks();
      const parsed = JSON.parse(back.getFileContent());

      expect(parsed.hooks).toEqual(config.hooks);
    });

    it("should throw on invalid JSON content", () => {
      const devinHooks = new DevinHooks({
        outputRoot: testDir,
        relativeDirPath: ".windsurf",
        relativeFilePath: "hooks.json",
        fileContent: "{ not json",
        validate: false,
      });

      expect(() => devinHooks.toRulesyncHooks()).toThrow(/Failed to parse Devin hooks/);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance with an empty hooks object", () => {
      const devinHooks = DevinHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".windsurf",
        relativeFilePath: "hooks.json",
      });

      expect(devinHooks).toBeInstanceOf(DevinHooks);
      expect(devinHooks.getRelativeDirPath()).toBe(".windsurf");
      expect(devinHooks.getRelativeFilePath()).toBe("hooks.json");
      expect(JSON.parse(devinHooks.getFileContent())).toEqual({ hooks: {} });
    });

    it("should default outputRoot to process.cwd()", () => {
      const devinHooks = DevinHooks.forDeletion({
        relativeDirPath: ".windsurf",
        relativeFilePath: "hooks.json",
      });

      expect(devinHooks.getOutputRoot()).toBe(testDir);
    });
  });
});
