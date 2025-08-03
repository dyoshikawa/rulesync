import { describe, expect, it } from "vitest";
import { getDefaultConfig, resolveTargets } from "../../src/utils/config.js";

describe("config utils", () => {
  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = getDefaultConfig();

      expect(config.aiRulesDir).toBe(".rulesync");
      expect(config.outputPaths.augmentcode).toBe(".");
      expect(config.outputPaths.copilot).toBe(".github/instructions");
      expect(config.outputPaths.cursor).toBe(".cursor/rules");
      expect(config.outputPaths.cline).toBe(".clinerules");
      expect(config.outputPaths.claudecode).toBe(".");
      expect(config.outputPaths.geminicli).toBe(".gemini/memories");
      expect(config.outputPaths.kiro).toBe(".kiro/steering");
      expect(config.defaultTargets).toEqual([
        "augmentcode",
        "copilot",
        "cursor",
        "cline",
        "claudecode",
        "codexcli",
        "roo",
        "geminicli",
        "kiro",
        "junie",
        "windsurf",
      ]);
      expect(config.watchEnabled).toBe(false);
    });
  });

  describe("resolveTargets", () => {
    const config = getDefaultConfig();

    it("should resolve * to all default targets", () => {
      const targets = resolveTargets(["*"], config);
      expect(targets).toEqual([
        "augmentcode",
        "copilot",
        "cursor",
        "cline",
        "claudecode",
        "codexcli",
        "roo",
        "geminicli",
        "kiro",
        "junie",
        "windsurf",
      ]);
    });

    it("should return specific targets as-is", () => {
      const targets = resolveTargets(["copilot", "cursor"], config);
      expect(targets).toEqual(["copilot", "cursor"]);
    });

    it("should handle single target", () => {
      const targets = resolveTargets(["copilot"], config);
      expect(targets).toEqual(["copilot"]);
    });

    it("should handle claudecode target", () => {
      const targets = resolveTargets(["claudecode"], config);
      expect(targets).toEqual(["claudecode"]);
    });

    it("should handle mixed targets including claudecode", () => {
      const targets = resolveTargets(["copilot", "claudecode"], config);
      expect(targets).toEqual(["copilot", "claudecode"]);
    });
  });
});
