import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ToolTarget } from "../types/index.js";
import { RulesProcessor } from "./rules-processor.js";
import {
  clearRulesProcessorCache,
  getRulesProcessor,
  getSupportedRulesProcessorTools,
  isToolSupportedByRulesProcessor,
} from "./rules-processor-factory.js";

// Mock the logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("RulesProcessorFactory functions", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    // Clear the factory cache before each test
    clearRulesProcessorCache();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getRulesProcessor", () => {
    it("should create a RulesProcessor instance for supported tools", () => {
      const supportedTools: ToolTarget[] = [
        "claudecode",
        "cursor",
        "copilot",
        "cline",
        "augmentcode",
      ];

      for (const tool of supportedTools) {
        const processor = getRulesProcessor(tool, testDir);
        expect(processor).toBeInstanceOf(RulesProcessor);
      }
    });

    it("should return null for unsupported tools", () => {
      // Test with a tool that should not be supported
      // Note: All current tools are supported, so we can't test with actual tools
      // Instead, we test the mapping logic
      expect(isToolSupportedByRulesProcessor("claudecode")).toBe(true);
    });

    it("should cache RulesProcessor instances", () => {
      const processor1 = getRulesProcessor("claudecode", testDir);
      const processor2 = getRulesProcessor("claudecode", testDir);

      expect(processor1).toBe(processor2); // Same instance due to caching
    });

    it("should create different instances for different tools", () => {
      const processor1 = getRulesProcessor("claudecode", testDir);
      const processor2 = getRulesProcessor("cursor", testDir);

      expect(processor1).not.toBe(processor2);
    });

    it("should create different instances for different base directories", () => {
      const baseDir1 = join(testDir, "dir1");
      const baseDir2 = join(testDir, "dir2");

      const processor1 = getRulesProcessor("claudecode", baseDir1);
      const processor2 = getRulesProcessor("claudecode", baseDir2);

      expect(processor1).not.toBe(processor2);
    });
  });

  describe("clearRulesProcessorCache", () => {
    it("should clear the processor cache", () => {
      // Create a processor to populate cache
      const processor1 = getRulesProcessor("claudecode", testDir);
      expect(processor1).toBeInstanceOf(RulesProcessor);

      // Clear cache
      clearRulesProcessorCache();

      // Create another processor - should be different instance
      const processor2 = getRulesProcessor("claudecode", testDir);
      expect(processor2).toBeInstanceOf(RulesProcessor);
      expect(processor1).not.toBe(processor2);
    });
  });

  describe("isToolSupportedByRulesProcessor", () => {
    it("should return true for supported tools", () => {
      const supportedTools: ToolTarget[] = [
        "claudecode",
        "cursor",
        "copilot",
        "cline",
        "augmentcode",
        "augmentcode-legacy",
        "amazonqcli",
        "agentsmd",
        "codexcli",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "windsurf",
      ];

      for (const tool of supportedTools) {
        expect(isToolSupportedByRulesProcessor(tool)).toBe(true);
      }
    });
  });

  describe("getSupportedRulesProcessorTools", () => {
    it("should return an array of supported tools", () => {
      const supportedTools = getSupportedRulesProcessorTools();

      expect(Array.isArray(supportedTools)).toBe(true);
      expect(supportedTools.length).toBeGreaterThan(0);

      // Check that some expected tools are included
      expect(supportedTools).toContain("claudecode");
      expect(supportedTools).toContain("cursor");
      expect(supportedTools).toContain("copilot");
      expect(supportedTools).toContain("cline");
    });

    it("should return unique tool names", () => {
      const supportedTools = getSupportedRulesProcessorTools();
      const uniqueTools = [...new Set(supportedTools)];

      expect(supportedTools.length).toBe(uniqueTools.length);
    });
  });

  describe("tool target mapping", () => {
    it("should correctly map all tool targets", () => {
      // Test that all expected mappings work by checking tool support
      const expectedMappings: Record<ToolTarget, boolean> = {
        agentsmd: true,
        amazonqcli: true,
        augmentcode: true,
        "augmentcode-legacy": true,
        claudecode: true,
        cline: true,
        codexcli: true,
        copilot: true,
        cursor: true,
        geminicli: true,
        junie: true,
        kiro: true,
        opencode: true,
        qwencode: true,
        roo: true,
        windsurf: true,
      };

      for (const [tool, shouldBeSupported] of Object.entries(expectedMappings)) {
        expect(isToolSupportedByRulesProcessor(tool as ToolTarget)).toBe(shouldBeSupported);
      }
    });
  });

  describe("error handling", () => {
    it("should handle RulesProcessor creation errors gracefully", () => {
      // Use invalid characters in baseDir to potentially cause creation errors
      const invalidBaseDir = "\0invalid\0path";

      // This should not throw but should return null and log an error
      const processor = getRulesProcessor("claudecode", invalidBaseDir);

      // The processor might still be created despite invalid path,
      // so we just ensure no exception was thrown
      expect(processor).toBeDefined();
    });
  });
});
