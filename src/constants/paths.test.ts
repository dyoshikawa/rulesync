import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RULESYNC_COMMANDS_DIR,
  RULESYNC_IGNORE_FILE,
  RULESYNC_MCP_FILE,
  RULESYNC_RULES_DIR,
  RULESYNC_RULES_DIR_LEGACY,
  RULESYNC_SUBAGENTS_DIR,
} from "./paths.js";

describe("path constants", () => {
  describe("RULESYNC_RULES_DIR", () => {
    it("should have correct rules directory path", () => {
      expect(RULESYNC_RULES_DIR).toBe(join(".rulesync", "rules"));
      expect(typeof RULESYNC_RULES_DIR).toBe("string");
    });

    it("should use proper path joining", () => {
      expect(RULESYNC_RULES_DIR).toBe(".rulesync/rules");
    });
  });

  describe("RULESYNC_RULES_DIR_LEGACY", () => {
    it("should have correct legacy rules directory", () => {
      expect(RULESYNC_RULES_DIR_LEGACY).toBe(".rulesync");
      expect(typeof RULESYNC_RULES_DIR_LEGACY).toBe("string");
    });
  });

  describe("RULESYNC_IGNORE_FILE", () => {
    it("should have correct ignore file name", () => {
      expect(RULESYNC_IGNORE_FILE).toBe(".rulesyncignore");
      expect(typeof RULESYNC_IGNORE_FILE).toBe("string");
    });
  });

  describe("RULESYNC_MCP_FILE", () => {
    it("should have correct MCP file path", () => {
      expect(RULESYNC_MCP_FILE).toBe(join(".rulesync", ".mcp.json"));
      expect(typeof RULESYNC_MCP_FILE).toBe("string");
    });

    it("should use proper path joining for MCP file", () => {
      expect(RULESYNC_MCP_FILE).toBe(".rulesync/.mcp.json");
    });
  });

  describe("RULESYNC_COMMANDS_DIR", () => {
    it("should have correct commands directory path", () => {
      expect(RULESYNC_COMMANDS_DIR).toBe(join(".rulesync", "commands"));
      expect(typeof RULESYNC_COMMANDS_DIR).toBe("string");
    });

    it("should use proper path joining for commands", () => {
      expect(RULESYNC_COMMANDS_DIR).toBe(".rulesync/commands");
    });
  });

  describe("RULESYNC_SUBAGENTS_DIR", () => {
    it("should have correct subagents directory path", () => {
      expect(RULESYNC_SUBAGENTS_DIR).toBe(join(".rulesync", "subagents"));
      expect(typeof RULESYNC_SUBAGENTS_DIR).toBe("string");
    });

    it("should use proper path joining for subagents", () => {
      expect(RULESYNC_SUBAGENTS_DIR).toBe(".rulesync/subagents");
    });
  });

  describe("constants consistency", () => {
    it("should have consistent base directory", () => {
      const baseDir = ".rulesync";

      expect(RULESYNC_RULES_DIR.startsWith(baseDir)).toBe(true);
      expect(RULESYNC_MCP_FILE.startsWith(baseDir)).toBe(true);
      expect(RULESYNC_COMMANDS_DIR.startsWith(baseDir)).toBe(true);
      expect(RULESYNC_SUBAGENTS_DIR.startsWith(baseDir)).toBe(true);
      expect(RULESYNC_RULES_DIR_LEGACY).toBe(baseDir);
    });

    it("should have correct file extensions", () => {
      expect(RULESYNC_IGNORE_FILE.startsWith(".")).toBe(true);
      expect(RULESYNC_MCP_FILE.endsWith(".json")).toBe(true);
    });

    it("should use relative paths (no leading slash)", () => {
      const allPaths = [
        RULESYNC_RULES_DIR,
        RULESYNC_RULES_DIR_LEGACY,
        RULESYNC_IGNORE_FILE,
        RULESYNC_MCP_FILE,
        RULESYNC_COMMANDS_DIR,
        RULESYNC_SUBAGENTS_DIR,
      ];

      allPaths.forEach((path) => {
        expect(path.startsWith("/")).toBe(false);
      });
    });

    it("should have no trailing slashes in directory constants", () => {
      expect(RULESYNC_RULES_DIR.endsWith("/")).toBe(false);
      expect(RULESYNC_RULES_DIR_LEGACY.endsWith("/")).toBe(false);
      expect(RULESYNC_COMMANDS_DIR.endsWith("/")).toBe(false);
      expect(RULESYNC_SUBAGENTS_DIR.endsWith("/")).toBe(false);
    });
  });

  describe("path structure", () => {
    it("should have correct nested directory structure", () => {
      // All nested directories should be under .rulesync
      expect(RULESYNC_RULES_DIR).toBe(".rulesync/rules");
      expect(RULESYNC_COMMANDS_DIR).toBe(".rulesync/commands");
      expect(RULESYNC_SUBAGENTS_DIR).toBe(".rulesync/subagents");
    });

    it("should have MCP file in correct location", () => {
      expect(RULESYNC_MCP_FILE).toBe(".rulesync/.mcp.json");
    });

    it("should have ignore file at root level", () => {
      expect(RULESYNC_IGNORE_FILE).toBe(".rulesyncignore");
      expect(RULESYNC_IGNORE_FILE.includes("/")).toBe(false);
    });
  });

  describe("immutability and type safety", () => {
    it("should have string constants that are not empty", () => {
      const allPaths = [
        RULESYNC_RULES_DIR,
        RULESYNC_RULES_DIR_LEGACY,
        RULESYNC_IGNORE_FILE,
        RULESYNC_MCP_FILE,
        RULESYNC_COMMANDS_DIR,
        RULESYNC_SUBAGENTS_DIR,
      ];

      allPaths.forEach((path) => {
        expect(typeof path).toBe("string");
        expect(path.length).toBeGreaterThan(0);
      });
    });

    it("should have unique path values", () => {
      const allPaths = [
        RULESYNC_RULES_DIR,
        RULESYNC_RULES_DIR_LEGACY,
        RULESYNC_IGNORE_FILE,
        RULESYNC_MCP_FILE,
        RULESYNC_COMMANDS_DIR,
        RULESYNC_SUBAGENTS_DIR,
      ];

      const uniquePaths = [...new Set(allPaths)];
      expect(uniquePaths).toHaveLength(allPaths.length);
    });

    it("should maintain constant reference identity", () => {
      const ref1 = RULESYNC_RULES_DIR;
      const ref2 = RULESYNC_RULES_DIR;
      expect(ref1).toBe(ref2);
    });
  });
});
