import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { KimiCodeMcp, KimiCodeMcpConfigToml } from "./kimi-code-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const CONFIG_PATH = [".kimi-code", "config.toml"] as const;

function rulesyncMcp(json: Record<string, unknown>): RulesyncMcp {
  return new RulesyncMcp({
    outputRoot: ".",
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify(json),
  });
}

describe("KimiCodeMcp global config defaults", () => {
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

  describe("getAuxiliaryFiles", () => {
    it("should emit the config file when a timeout default is authored", async () => {
      const files = await KimiCodeMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp: rulesyncMcp({
          mcpServers: {},
          "kimi-code": { startupTimeoutMs: 45000, toolTimeoutMs: 90000 },
        }),
      });

      expect(files).toHaveLength(1);
      expect(files[0]!.getFileContent()).toContain("startup_timeout_ms = 45000");
      expect(files[0]!.getFileContent()).toContain("tool_timeout_ms = 90000");
    });

    it("should emit nothing at project scope, where config.toml has no counterpart", async () => {
      expect(
        await KimiCodeMcp.getAuxiliaryFiles({
          outputRoot: testDir,
          global: false,
          rulesyncMcp: rulesyncMcp({
            mcpServers: {},
            "kimi-code": { startupTimeoutMs: 45000 },
          }),
        }),
      ).toEqual([]);
    });

    it.each([
      { name: "no kimi-code block", json: { mcpServers: {} } },
      { name: "a non-record kimi-code block", json: { mcpServers: {}, "kimi-code": "nope" } },
      { name: "no timeout keys", json: { mcpServers: {}, "kimi-code": { mcpServers: {} } } },
      {
        name: "non-numeric timeouts",
        json: { mcpServers: {}, "kimi-code": { startupTimeoutMs: "45000" } },
      },
    ])("should emit nothing for $name", async ({ json }) => {
      expect(
        await KimiCodeMcp.getAuxiliaryFiles({
          outputRoot: testDir,
          global: true,
          rulesyncMcp: rulesyncMcp(json),
        }),
      ).toEqual([]);
    });
  });

  describe("the emitted config file", () => {
    const emit = async ({
      defaults,
      outputRoot,
    }: {
      defaults: Record<string, number>;
      outputRoot: string;
    }) =>
      (
        await KimiCodeMcp.getAuxiliaryFiles({
          outputRoot,
          global: true,
          rulesyncMcp: rulesyncMcp({ mcpServers: {}, "kimi-code": defaults }),
        })
      )[0];

    it("should never be deletable, because three features and the user share the file", async () => {
      const file = await emit({ defaults: { startupTimeoutMs: 1000 }, outputRoot: testDir });

      expect(file).toBeInstanceOf(KimiCodeMcpConfigToml);
      expect(file!.isDeletable()).toBe(false);
      expect(file!.validate()).toEqual({ success: true, error: null });
    });

    it("should preserve the sibling timeout and unknown keys when only one is authored", async () => {
      // The gateway replaces an owned key wholesale and `mcp` is a table, so a
      // partial override must not delete anything else in the section.
      await writeFileContent(
        join(testDir, ...CONFIG_PATH),
        'my_unmanaged = "keep"\n\n[mcp]\nstartup_timeout_ms = 1000\ntool_timeout_ms = 2000\nsome_future_key = "x"\n',
      );

      const file = await emit({ defaults: { startupTimeoutMs: 45000 }, outputRoot: testDir });

      expect(file!.getFileContent()).toContain("startup_timeout_ms = 45000");
      expect(file!.getFileContent()).toContain("tool_timeout_ms = 2000");
      expect(file!.getFileContent()).toContain('some_future_key = "x"');
      expect(file!.getFileContent()).toContain('my_unmanaged = "keep"');
    });

    it("should preserve the hooks and permission sections of the shared file", async () => {
      await writeFileContent(
        join(testDir, ...CONFIG_PATH),
        [
          "[[hooks]]",
          'event = "SessionStart"',
          'command = "echo hi"',
          "",
          "[permission]",
          'rules = [{ decision = "deny", pattern = "Bash(rm *)", scope = "user" }]',
        ].join("\n"),
      );

      const file = await emit({ defaults: { toolTimeoutMs: 90000 }, outputRoot: testDir });

      expect(file!.getFileContent()).toContain('event = "SessionStart"');
      expect(file!.getFileContent()).toContain('pattern = "Bash(rm *)"');
      expect(file!.getFileContent()).toContain("tool_timeout_ms = 90000");
    });

    it("should skip only itself when the shared config is not valid TOML", async () => {
      // The servers in `mcp.json` have nothing to do with `config.toml`, so a
      // hand-broken config must not stop them being written.
      await writeFileContent(join(testDir, ...CONFIG_PATH), "this is not = = toml");
      const logger = createMockLogger();

      const files = await KimiCodeMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp: rulesyncMcp({ mcpServers: {}, "kimi-code": { startupTimeoutMs: 45000 } }),
        logger,
      });

      expect(files).toEqual([]);
      expect(
        logger.warn.mock.calls.some(([message]) => String(message).includes("not valid TOML")),
      ).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should read the defaults back for the round trip", async () => {
      await writeFileContent(
        join(testDir, ...CONFIG_PATH),
        "[mcp]\nstartup_timeout_ms = 45000\ntool_timeout_ms = 90000\n",
      );
      await writeFileContent(join(testDir, ".kimi-code", "mcp.json"), '{"mcpServers":{}}');

      const imported = (
        await KimiCodeMcp.fromFile({ outputRoot: testDir, global: true })
      ).toRulesyncMcp();

      expect(JSON.parse(imported.getFileContent())["kimi-code"]).toEqual({
        startupTimeoutMs: 45000,
        toolTimeoutMs: 90000,
      });
    });

    it.each([
      { name: "an absent config file", content: undefined },
      { name: "unparseable TOML", content: "this is not = = toml" },
      { name: "a non-table mcp key", content: 'mcp = "nope"\n' },
    ])("should import without defaults for $name", async ({ content }) => {
      if (content !== undefined) {
        await writeFileContent(join(testDir, ...CONFIG_PATH), content);
      }
      await writeFileContent(join(testDir, ".kimi-code", "mcp.json"), '{"mcpServers":{}}');

      const imported = (
        await KimiCodeMcp.fromFile({ outputRoot: testDir, global: true })
      ).toRulesyncMcp();

      expect(JSON.parse(imported.getFileContent())["kimi-code"]).toBeUndefined();
    });

    it("should not read the config file at project scope", async () => {
      await writeFileContent(join(testDir, ...CONFIG_PATH), "[mcp]\nstartup_timeout_ms = 45000\n");
      await writeFileContent(join(testDir, ".kimi-code", "mcp.json"), '{"mcpServers":{}}');

      const imported = (
        await KimiCodeMcp.fromFile({ outputRoot: testDir, global: false })
      ).toRulesyncMcp();

      expect(JSON.parse(imported.getFileContent())["kimi-code"]).toBeUndefined();
      // Sanity: the config file itself is untouched.
      expect(await readFileContent(join(testDir, ...CONFIG_PATH))).toContain("startup_timeout_ms");
    });
  });
});
