import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

// Create a concrete test implementation of the abstract ToolIgnore class
class TestToolIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      frontmatter: {
        targets: ["claudecode"],
        description: `Generated from test tool ignore file: ${this.relativeFilePath}`,
        patterns: this.patterns,
      },
      body: this.patterns.join("\n"),
      baseDir: this.baseDir,
      relativeDirPath: "ignore",
      relativeFilePath: "claudecode.ignore.md",
      fileContent: `---
targets:
  - claudecode
description: Generated from test tool ignore file: ${this.relativeFilePath}
patterns:
${this.patterns.map((pattern) => `  - "${pattern}"`).join("\n")}
---

${this.patterns.join("\n")}`,
    });
  }

  static async fromFilePath(_params: { filePath: string }): Promise<TestToolIgnore> {
    // This would typically read from file, but for tests we'll create a simple implementation
    return new TestToolIgnore({
      baseDir: ".",
      relativeDirPath: "test",
      relativeFilePath: "test.ignore",
      patterns: ["test-pattern"],
      fileContent: "test-pattern",
    });
  }

  static fromRulesyncIgnore(params: {
    baseDir?: string;
    relativeDirPath: string;
    rulesyncIgnore: RulesyncIgnore;
  }): TestToolIgnore {
    const frontmatter = params.rulesyncIgnore.getFrontmatter();
    const patterns = frontmatter.patterns || [];

    return new TestToolIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: "claudecode.ignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }
}

describe("ToolIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with patterns", () => {
      const patterns = ["node_modules/", "*.log", ".env*"];
      const toolIgnore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".test",
        relativeFilePath: "ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(toolIgnore.getPatterns()).toEqual(patterns);
    });

    it("should validate patterns array", () => {
      expect(() => {
        const _ignored = new TestToolIgnore({
          baseDir: testDir,
          relativeDirPath: ".test",
          relativeFilePath: "ignore",
          patterns: null as any,
          fileContent: "",
        });
      }).toThrow("Patterns must be defined");

      expect(() => {
        const _ignored = new TestToolIgnore({
          baseDir: testDir,
          relativeDirPath: ".test",
          relativeFilePath: "ignore",
          patterns: "not-array" as any,
          fileContent: "",
        });
      }).toThrow("Patterns must be an array");
    });

    it("should skip validation when validate option is false", () => {
      expect(() => {
        const _ignored = new TestToolIgnore({
          baseDir: testDir,
          relativeDirPath: ".test",
          relativeFilePath: "ignore",
          patterns: null as any,
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getPatterns", () => {
    it("should return patterns array", () => {
      const patterns = ["*.tmp", "build/", "dist/"];
      const toolIgnore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".test",
        relativeFilePath: "ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(toolIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("validate", () => {
    it("should return success for valid patterns array", () => {
      const toolIgnore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".test",
        relativeFilePath: "ignore",
        patterns: ["*.log", "node_modules/"],
        fileContent: "",
      });

      const result = toolIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid patterns", () => {
      const toolIgnore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".test",
        relativeFilePath: "ignore",
        patterns: null as any,
        fileContent: "",
        validate: false,
      });

      const result = toolIgnore.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Patterns must be defined");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct frontmatter", () => {
      const patterns = ["node_modules/", "*.log"];
      const toolIgnore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".test",
        relativeFilePath: "test.ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = toolIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["claudecode"],
        description: "Generated from test tool ignore file: test.ignore",
        patterns,
      });
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create instance from RulesyncIgnore", () => {
      const patterns = ["*.tmp", "build/"];
      const rulesyncIgnore = new RulesyncIgnore({
        frontmatter: {
          targets: ["claudecode"],
          description: "Test ignore patterns",
          patterns,
        },
        body: patterns.join("\n"),
        baseDir: testDir,
        relativeDirPath: "ignore",
        relativeFilePath: "test.ignore.md",
        fileContent: `---
targets:
  - claudecode
description: Test ignore patterns
patterns:
${patterns.map((pattern) => `  - "${pattern}"`).join("\n")}
---

${patterns.join("\n")}`,
      });

      const toolIgnore = TestToolIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".test",
        rulesyncIgnore,
      });

      expect(toolIgnore.getPatterns()).toEqual(patterns);
      expect(toolIgnore.getRelativeDirPath()).toBe(".test");
      expect(toolIgnore.getRelativeFilePath()).toBe("claudecode.ignore");
    });
  });

  describe("static methods", () => {
    it("should throw error for abstract fromFilePath method", async () => {
      await expect(ToolIgnore.fromFilePath({ filePath: "test" })).rejects.toThrow(
        "Please implement this method in the subclass.",
      );
    });

    it("should throw error for abstract fromRulesyncIgnore method", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        frontmatter: {
          targets: ["claudecode"],
          description: "Test",
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: "ignore",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(() => {
        ToolIgnore.fromRulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".test",
          rulesyncIgnore,
        });
      }).toThrow("Please implement this method in the subclass.");
    });
  });
});
