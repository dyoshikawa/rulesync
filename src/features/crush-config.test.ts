import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import {
  crushConfigImportContent,
  getCrushConfigSettablePaths,
  mergeCrushConfigs,
  parseCrushConfig,
  resolveCrushConfigFile,
  warnCrushTwinLeftovers,
} from "./crush-config.js";

describe("crush-config", () => {
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

  describe("getCrushConfigSettablePaths", () => {
    it("should point to crush.json at project scope and ~/.config/crush at global scope", () => {
      expect(getCrushConfigSettablePaths()).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
      expect(getCrushConfigSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "crush.json",
      });
    });
  });

  describe("resolveCrushConfigFile", () => {
    it("should use crush.json when neither file exists", async () => {
      const location = await resolveCrushConfigFile({ outputRoot: testDir });
      expect(location.relativeFilePath).toBe("crush.json");
      expect(location.fileContent).toBeNull();
      expect(location.twin).toBeUndefined();
    });

    it("should prefer an existing .crush.json and expose crush.json as its twin", async () => {
      await writeFileContent(join(testDir, ".crush.json"), "{}");
      await writeFileContent(join(testDir, "crush.json"), '{"options":{}}');

      const location = await resolveCrushConfigFile({ outputRoot: testDir });
      expect(location.relativeFilePath).toBe(".crush.json");
      expect(location.twin).toEqual({
        filePath: join(testDir, "crush.json"),
        fileContent: '{"options":{}}',
      });
    });

    it("should have no twin when only .crush.json exists", async () => {
      await writeFileContent(join(testDir, ".crush.json"), "{}");

      const location = await resolveCrushConfigFile({ outputRoot: testDir });
      expect(location.relativeFilePath).toBe(".crush.json");
      expect(location.twin).toBeUndefined();
    });

    it("should ignore a project .crush.json at global scope", async () => {
      await writeFileContent(join(testDir, ".crush.json"), "{}");

      const location = await resolveCrushConfigFile({ outputRoot: testDir, global: true });
      expect(location.relativeDirPath).toBe(join(".config", "crush"));
      expect(location.relativeFilePath).toBe("crush.json");
      expect(location.twin).toBeUndefined();
    });
  });

  describe("parseCrushConfig", () => {
    it("should return an empty document for empty content", () => {
      expect(parseCrushConfig("")).toEqual({});
    });

    it("should throw on an unparseable or non-object root", () => {
      expect(() => parseCrushConfig("{ nope")).toThrow();
      expect(() => parseCrushConfig("[]")).toThrow();
    });
  });

  describe("mergeCrushConfigs", () => {
    it("should merge objects recursively, concatenate arrays and override scalars", () => {
      expect(
        mergeCrushConfigs({
          base: {
            options: { debug: true, disabled_tools: ["fetch"] },
            hooks: { PreToolUse: [{ command: "a" }] },
            mcp: { fs: { command: "fs", timeout: 5 } },
          },
          override: {
            options: { debug: false, disabled_tools: ["bash"] },
            hooks: { PreToolUse: [{ command: "b" }] },
            mcp: { fs: { command: "fs2" }, gh: { command: "gh" } },
          },
        }),
      ).toEqual({
        options: { debug: false, disabled_tools: ["fetch", "bash"] },
        hooks: { PreToolUse: [{ command: "a" }, { command: "b" }] },
        mcp: { fs: { command: "fs2", timeout: 5 }, gh: { command: "gh" } },
      });
    });

    it("should let a differently typed override value replace the base value", () => {
      expect(mergeCrushConfigs({ base: { a: [1] }, override: { a: { b: 1 } } })).toEqual({
        a: { b: 1 },
      });
    });

    it("should skip prototype-pollution keys", () => {
      const override = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
      const merged = mergeCrushConfigs({ base: {}, override });
      expect(merged).toEqual({ ok: 1 });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe("crushConfigImportContent", () => {
    it("should return the file itself when there is no twin", () => {
      expect(
        crushConfigImportContent({
          relativeDirPath: ".",
          relativeFilePath: "crush.json",
          filePath: join(testDir, "crush.json"),
          fileContent: '{"mcp":{}}',
        }),
      ).toBe('{"mcp":{}}');
      expect(
        crushConfigImportContent({
          relativeDirPath: ".",
          relativeFilePath: "crush.json",
          filePath: join(testDir, "crush.json"),
          fileContent: null,
        }),
      ).toBe("{}");
    });

    it("should merge the chosen file over its twin", () => {
      const content = crushConfigImportContent({
        relativeDirPath: ".",
        relativeFilePath: ".crush.json",
        filePath: join(testDir, ".crush.json"),
        fileContent: '{"permissions":{"allowed_tools":["view"]}}',
        twin: {
          filePath: join(testDir, "crush.json"),
          fileContent: '{"permissions":{"allowed_tools":["bash"],"skip_requests":true}}',
        },
      });
      expect(JSON.parse(content)).toEqual({
        permissions: { allowed_tools: ["bash", "view"], skip_requests: true },
      });
    });
  });

  describe("warnCrushTwinLeftovers", () => {
    const location = (twinContent: string) => ({
      relativeDirPath: ".",
      relativeFilePath: ".crush.json",
      filePath: join(testDir, ".crush.json"),
      fileContent: "{}",
      twin: { filePath: join(testDir, "crush.json"), fileContent: twinContent },
    });

    it("should do nothing without a twin", () => {
      const logger = createMockLogger();
      warnCrushTwinLeftovers({
        location: {
          relativeDirPath: ".",
          relativeFilePath: "crush.json",
          filePath: join(testDir, "crush.json"),
          fileContent: "{}",
        },
        ownedPaths: [["mcp"]],
        logger,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should name every owned path the twin still populates", () => {
      const logger = createMockLogger();
      warnCrushTwinLeftovers({
        location: location(
          JSON.stringify({
            permissions: { allowed_tools: ["bash"] },
            options: { disabled_tools: [], debug: true },
            hooks: { PreToolUse: [{ command: "x" }] },
          }),
        ),
        ownedPaths: [["permissions", "allowed_tools"], ["options", "disabled_tools"], ["hooks"]],
        logger,
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const message = String(logger.warn.mock.calls[0]?.[0]);
      expect(message).toContain('"permissions.allowed_tools"');
      expect(message).toContain('"hooks"');
      expect(message).not.toContain('"options.disabled_tools"');
      expect(message).toContain(join(testDir, "crush.json"));
    });

    it("should stay quiet when the twin has no owned entries or cannot be parsed", () => {
      const logger = createMockLogger();
      warnCrushTwinLeftovers({
        location: location(JSON.stringify({ options: { debug: true }, mcp: {} })),
        ownedPaths: [["mcp"], ["hooks"]],
        logger,
      });
      warnCrushTwinLeftovers({ location: location("{ nope"), ownedPaths: [["mcp"]], logger });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
