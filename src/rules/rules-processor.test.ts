import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { CopilotRule } from "./copilot-rule.js";
import { RulesProcessor } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("RulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default baseDir", () => {
      const processor = new RulesProcessor({ toolTarget: "copilot" });
      expect(processor).toBeInstanceOf(RulesProcessor);
    });

    it("should create instance with custom baseDir", () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });
      expect(processor).toBeInstanceOf(RulesProcessor);
    });

    it("should validate toolTarget with schema", () => {
      expect(() => {
        new RulesProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync rules to copilot rules", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_DIR,
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test rule",
          globs: ["*.js"],
        },
        body: "Test body content",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncRule]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CopilotRule);
    });

    it("should throw error for unsupported tool target", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      // Force an unsupported tool target
      (processor as any).toolTarget = "unsupported";

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_DIR,
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test rule",
          globs: ["*.js"],
        },
        body: "Test body content",
      });

      await expect(processor.convertRulesyncFilesToToolFiles([rulesyncRule])).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });

    it("should filter non-RulesyncRule files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const nonRulesyncFile = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        fileContent: "Non-rulesync file content",
      });

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_DIR,
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test rule",
          globs: ["*.js"],
        },
        body: "Test body content",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        nonRulesyncFile,
        rulesyncRule,
      ]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CopilotRule);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert tool rules to rulesync rules", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        fileContent: `---
description: "Test rule"
applyTo: "*.js"
---

Test instructions`,
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([copilotRule]);

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncRule);
    });

    it("should filter non-ToolRule files", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const nonToolRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_DIR,
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Non-tool rule",
          globs: ["*.js"],
        },
        body: "Test content",
      });

      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        fileContent: `---
description: "Test rule"
applyTo: "*.js"
---

Test instructions`,
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([
        nonToolRule,
        copilotRule,
      ]);

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncRule);
    });
  });

  describe("getToolTargets", () => {
    it("should return array of supported tool targets", () => {
      const toolTargets = RulesProcessor.getToolTargets();

      expect(Array.isArray(toolTargets)).toBe(true);
      expect(toolTargets).toContain("agentsmd");
      expect(toolTargets).toContain("amazonqcli");
      expect(toolTargets).toContain("augmentcode");
      expect(toolTargets).toContain("copilot");
      expect(toolTargets).toContain("cursor");
      expect(toolTargets).toContain("claudecode");
      expect(toolTargets.length).toBeGreaterThan(10);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should return empty array when no rulesync files exist", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toHaveLength(0);
    });
  });

  describe("loadToolFiles", () => {
    it("should return empty array when no tool files exist", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const toolFiles = await processor.loadToolFiles();
      expect(toolFiles).toHaveLength(0);
    });

    it("should return empty array on error", async () => {
      const processor = new RulesProcessor({
        baseDir: "/non-existent-path",
        toolTarget: "copilot",
      });

      const toolFiles = await processor.loadToolFiles();
      expect(toolFiles).toHaveLength(0);
    });
  });

  describe("generateXmlReferencesSection", () => {
    it("should generate XML references section correctly", () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const nonRootRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "rule1.md",
        fileContent: `---
description: "Rule 1"
applyTo: "*.ts"
---

Rule 1 content`,
      });

      const toolRules = [nonRootRule];

      // Use private method via any cast for testing
      const xmlSection = (processor as any).generateXmlReferencesSection(toolRules);

      expect(xmlSection).toContain("Please also reference the following documents");
      expect(xmlSection).toContain("<Documents>");
      expect(xmlSection).toContain("<Document>");
      expect(xmlSection).toContain("<Path>@.github/instructions/rule1.md</Path>");
      expect(xmlSection).toContain("<Description>Rule 1</Description>");
    });

    it("should return empty string when no non-root rules", () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const rootRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        fileContent: `---
description: "Root rule"
applyTo: "*.js"
---

Root content`,
        root: true,
      });

      // Mock isRoot to return true for this test
      vi.spyOn(rootRule, "isRoot").mockReturnValue(true);

      const toolRules = [rootRule];

      const xmlSection = (processor as any).generateXmlReferencesSection(toolRules);

      expect(xmlSection).toBe("");
    });
  });
});
