import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { ToolCommand, ToolCommandFromRulesyncCommandParams } from "./tool-command.js";

// Mock concrete implementation for testing the abstract class
class MockToolCommand extends ToolCommand {
  private readonly body: string;
  private readonly frontmatter: Record<string, unknown>;

  constructor({
    body,
    frontmatter,
    ...rest
  }: {
    body: string;
    frontmatter: Record<string, unknown>;
    baseDir?: string;
    relativeDirPath: string;
    relativeFilePath: string;
    fileContent: string;
    validate?: boolean;
  }) {
    super(rest);
    this.body = body;
    this.frontmatter = frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<MockToolCommand> {
    // Mock implementation
    return new MockToolCommand({
      body: "Mock body from file",
      frontmatter: { description: "Mock command from file" },
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: "Mock file content",
    });
  }

  static fromRulesyncCommand(params: ToolCommandFromRulesyncCommandParams): MockToolCommand {
    const { rulesyncCommand, ...rest } = params;
    return new MockToolCommand({
      body: rulesyncCommand.getBody(),
      frontmatter: {
        description: rulesyncCommand.getFrontmatter().description,
        mockField: "converted",
      },
      ...rest,
      relativeFilePath: "converted.md",
      fileContent: `Mock conversion of: ${rulesyncCommand.getFileContent()}`,
    });
  }

  toRulesyncCommand(): RulesyncCommand {
    const frontmatter: RulesyncCommandFrontmatter = {
      targets: ["claudecode"],
      description: this.frontmatter.description as string,
    };

    return new RulesyncCommand({
      frontmatter,
      body: this.body,
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: "converted-back.md",
      fileContent: `---\ntargets: ["claudecode"]\ndescription: "${this.frontmatter.description}"\n---\n\n${this.body}`,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

describe("ToolCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("abstract class behavior", () => {
    it("should require implementation of abstract methods", () => {
      // The abstract class itself cannot be instantiated
      expect(() => {
        // @ts-expect-error - Cannot create an instance of an abstract class
        const _ = new ToolCommand({
          baseDir: testDir,
          relativeDirPath: ".test/commands",
          relativeFilePath: "test.md",
          fileContent: "test content",
        });
        // Use the variable to avoid unused variable warning
        return _;
      }).toThrow();
    });

    it("should require implementation of static fromFilePath method", async () => {
      await expect(
        ToolCommand.fromFilePath({
          filePath: "/mock/path.md",
          baseDir: testDir,
          relativeDirPath: ".test/commands",
          relativeFilePath: "path.md",
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should require implementation of static fromRulesyncCommand method", () => {
      const mockRulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Mock command",
        },
        body: "Mock body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "mock.md",
        fileContent: "Mock content",
      });

      expect(() => {
        ToolCommand.fromRulesyncCommand({
          rulesyncCommand: mockRulesyncCommand,
          baseDir: testDir,
          relativeDirPath: ".test/commands",
          validate: false,
        });
      }).toThrow("Please implement this method in the subclass.");
    });
  });

  describe("concrete implementation behavior", () => {
    it("should allow concrete implementations to work properly", () => {
      const mockCommand = new MockToolCommand({
        body: "Test body",
        frontmatter: { description: "Test description" },
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      expect(mockCommand).toBeInstanceOf(ToolCommand);
      expect(mockCommand.getBody()).toBe("Test body");
      expect(mockCommand.getFrontmatter()).toEqual({ description: "Test description" });
      expect(mockCommand.getRelativeDirPath()).toBe(".mock/commands");
      expect(mockCommand.getRelativeFilePath()).toBe("test.md");
      expect(mockCommand.getFileContent()).toBe("Test content");
    });

    it("should support fromFilePath implementation", async () => {
      const mockCommand = await MockToolCommand.fromFilePath({
        filePath: "/mock/path.md",
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        relativeFilePath: "path.md",
      });

      expect(mockCommand).toBeInstanceOf(MockToolCommand);
      expect(mockCommand.getBody()).toBe("Mock body from file");
      expect(mockCommand.getFrontmatter()).toEqual({ description: "Mock command from file" });
    });

    it("should support fromRulesyncCommand conversion", () => {
      const rulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Original command",
        },
        body: "Original body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "original.md",
        fileContent: "Original content",
      });

      const mockCommand = MockToolCommand.fromRulesyncCommand({
        rulesyncCommand,
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
      });

      expect(mockCommand).toBeInstanceOf(MockToolCommand);
      expect(mockCommand.getBody()).toBe("Original body");
      expect(mockCommand.getFrontmatter()).toEqual({
        description: "Original command",
        mockField: "converted",
      });
    });

    it("should support toRulesyncCommand conversion", () => {
      const mockCommand = new MockToolCommand({
        body: "Mock body",
        frontmatter: { description: "Mock description" },
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        relativeFilePath: "mock.md",
        fileContent: "Mock content",
      });

      const rulesyncCommand = mockCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Mock body");
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["claudecode"],
        description: "Mock description",
      });
    });

    it("should support round-trip conversion", () => {
      // Create original RulesyncCommand
      const originalRulesync = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Round-trip test",
        },
        body: "Round-trip body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "roundtrip.md",
        fileContent: "Round-trip content",
      });

      // Convert to MockToolCommand
      const mockCommand = MockToolCommand.fromRulesyncCommand({
        rulesyncCommand: originalRulesync,
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
      });

      // Convert back to RulesyncCommand
      const convertedRulesync = mockCommand.toRulesyncCommand();

      // Check that core data is preserved
      expect(convertedRulesync.getBody()).toBe(originalRulesync.getBody());
      expect(convertedRulesync.getFrontmatter().description).toBe(
        originalRulesync.getFrontmatter().description,
      );
      expect(convertedRulesync.getFrontmatter().targets).toEqual(["claudecode"]);
    });
  });

  describe("inheritance from AiFile", () => {
    it("should inherit AiFile functionality", () => {
      const mockCommand = new MockToolCommand({
        body: "Inherited body",
        frontmatter: { description: "Inherited description" },
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        relativeFilePath: "inherited.md",
        fileContent: "Inherited content",
      });

      // Test inherited methods from AiFile
      expect(mockCommand.getRelativeDirPath()).toBe(".mock/commands");
      expect(mockCommand.getRelativeFilePath()).toBe("inherited.md");
      expect(mockCommand.getFileContent()).toBe("Inherited content");
      expect(mockCommand.getFilePath()).toContain("inherited.md");
    });

    it("should support validation", () => {
      const mockCommand = new MockToolCommand({
        body: "Validated body",
        frontmatter: { description: "Validated description" },
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        relativeFilePath: "validated.md",
        fileContent: "Validated content",
      });

      const result = mockCommand.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("parameter validation", () => {
    it("should handle ToolCommandFromRulesyncCommandParams correctly", () => {
      const rulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Parameter test",
        },
        body: "Parameter body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "param-test.md",
        fileContent: "Parameter content",
      });

      const params: ToolCommandFromRulesyncCommandParams = {
        rulesyncCommand,
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        validate: false,
      };

      const mockCommand = MockToolCommand.fromRulesyncCommand(params);

      expect(mockCommand).toBeInstanceOf(MockToolCommand);
      expect(mockCommand.getBody()).toBe("Parameter body");
    });

    it("should handle validation parameter properly", () => {
      const rulesyncCommand = new RulesyncCommand({
        frontmatter: {
          targets: ["claudecode"],
          description: "Validation test",
        },
        body: "Validation body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "validation-test.md",
        fileContent: "Validation content",
      });

      // Test with validation disabled
      const mockCommand = MockToolCommand.fromRulesyncCommand({
        rulesyncCommand,
        baseDir: testDir,
        relativeDirPath: ".mock/commands",
        validate: false,
      });

      expect(mockCommand).toBeInstanceOf(MockToolCommand);
    });
  });
});
