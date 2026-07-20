import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PiHooks } from "./pi-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function buildRulesyncHooks({
  testDir,
  config,
}: {
  testDir: string;
  config: Record<string, unknown>;
}): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });
}

describe("PiHooks", () => {
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
    it("should return .pi/extensions and rulesync-hooks.ts", () => {
      const paths = PiHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
    });

    it("should return .pi/agent/extensions for global mode", () => {
      const paths = PiHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".pi", "agent", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Pi-supported events and map to snake_case", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          sessionEnd: [{ command: "teardown.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          beforeSubmitPrompt: [{ command: "pre-prompt.sh" }],
          preModelInvocation: [{ command: "pre-model.sh" }],
          preCompact: [{ command: "pre-compact.sh" }],
          // notification has no Pi extension event equivalent
          notification: [{ command: "notify.sh" }],
          // afterFileEdit has no Pi extension event equivalent
          afterFileEdit: [{ command: "format.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain('pi.on("session_start", async () => {');
      expect(content).toContain(".rulesync/hooks/session-start.sh");
      expect(content).toContain('pi.on("session_shutdown", async () => {');
      expect(content).toContain("teardown.sh");
      expect(content).toContain('pi.on("agent_end", async () => {');
      expect(content).toContain(".rulesync/hooks/audit.sh");
      expect(content).toContain('pi.on("input", async () => {');
      expect(content).toContain("pre-prompt.sh");
      expect(content).toContain('pi.on("context", async () => {');
      expect(content).toContain("pre-model.sh");
      expect(content).toContain('pi.on("session_before_compact", async () => {');
      expect(content).toContain("pre-compact.sh");

      // Unsupported events should not appear
      expect(content).not.toContain("notify.sh");
      expect(content).not.toContain("format.sh");
    });

    it("should generate tool event handlers honoring matchers against event.toolName", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "Write|Edit" }],
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain('pi.on("tool_call", async (event) => {');
      expect(content).toContain('if (new RegExp("Write|Edit").test(event.toolName)) {');
      expect(content).toContain("lint.sh");
      // postToolUse has no matcher, so the handler ignores the event payload
      expect(content).toContain('pi.on("tool_result", async () => {');
      expect(content).toContain("post-tool.sh");
    });

    it("should normalize only bare wildcard matcher to regex match-all pattern", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "all-tools.sh", matcher: "*" },
            { type: "command", command: "read-tools.sh", matcher: "Read*" },
          ],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain('new RegExp(".*")');
      expect(content).toContain('new RegExp("Read*")');
      expect(content).toContain("all-tools.sh");
      expect(content).toContain("read-tools.sh");
    });

    it("should skip prompt-type hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: ".rulesync/hooks/session-start.sh" },
            { type: "prompt", prompt: "Remember to use TypeScript" },
          ],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain(".rulesync/hooks/session-start.sh");
      expect(content).not.toContain("Remember to use TypeScript");
    });

    it("should merge config.pi.hooks on top of shared hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        pi: {
          hooks: {
            sessionStart: [{ type: "command", command: "pi-override.sh" }],
            stop: [{ command: "pi-only.sh" }],
          },
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain("pi-override.sh");
      expect(content).not.toContain("shared.sh");
      expect(content).toContain("pi-only.sh");
    });

    it("should generate an inert extension for an empty hooks config", () => {
      const config = {
        version: 1,
        hooks: {},
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      expect(piHooks.getFileContent()).toBe(
        [
          "// Generated by rulesync. Do not edit manually.",
          "export default function () {}",
          "",
        ].join("\n"),
      );
    });

    it("should embed commands as JS string literals with quotes and backslashes escaped", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: 'echo "C:\\temp" `date` ${HOME}' }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const content = piHooks.getFileContent();
      expect(content).toContain(`await run(${JSON.stringify('echo "C:\\temp" `date` ${HOME}')});`);
    });

    it("should throw on invalid regex in matcher", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "[invalid" }],
        },
      };
      expect(() =>
        PiHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: buildRulesyncHooks({ testDir, config }),
          validate: false,
        }),
      ).toThrow("Invalid regex pattern in hook matcher");
    });

    it("should strip control characters from matcher", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "Write\n|Edit\r\0" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      expect(piHooks.getFileContent()).toContain('new RegExp("Write|Edit")');
    });

    it("should generate a loadable TypeScript module that registers the mapped events", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: 'echo "hi" `date` ${HOME}' }],
          preToolUse: [
            { type: "command", command: "lint.sh", matcher: "Write|Edit" },
            { type: "command", command: "audit.sh" },
          ],
          stop: [{ command: "done.sh" }],
        },
      };
      const piHooks = PiHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ testDir, config }),
        validate: false,
      });

      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const filePath = join(extensionsDir, "rulesync-hooks.ts");
      await writeFileContent(filePath, piHooks.getFileContent());

      const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
      const on = vi.fn();
      mod.default({ on });
      expect(on.mock.calls.map(([event]) => event)).toEqual([
        "session_start",
        "tool_call",
        "agent_end",
      ]);
      expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw because Pi hooks cannot be converted back", () => {
      const piHooks = new PiHooks({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
        fileContent: "export default function () {}",
        validate: false,
      });

      expect(() => piHooks.toRulesyncHooks()).toThrow(
        "Not implemented because Pi hooks are generated as a TypeScript extension file.",
      );
    });
  });

  describe("fromFile", () => {
    it("should load from .pi/extensions/rulesync-hooks.ts", async () => {
      const extensionsDir = join(testDir, ".pi", "extensions");
      await ensureDir(extensionsDir);
      const content = "export default function () {}";
      await writeFileContent(join(extensionsDir, "rulesync-hooks.ts"), content);

      const piHooks = await PiHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(piHooks).toBeInstanceOf(PiHooks);
      expect(piHooks.getFileContent()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should return PiHooks instance with empty content for deletion", () => {
      const hooks = PiHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
      expect(hooks).toBeInstanceOf(PiHooks);
      expect(hooks.getFileContent()).toBe("");
    });
  });

  describe("isDeletable", () => {
    it("should return true (extension file is standalone and deletable)", () => {
      const hooks = new PiHooks({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
        fileContent: "",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});
