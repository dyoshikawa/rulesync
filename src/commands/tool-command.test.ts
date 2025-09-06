import { describe, expect, it } from "vitest";
import { ValidationResult } from "../types/ai-file.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

// Test implementation of ToolCommand
class TestToolCommand extends ToolCommand {
  validate(): ValidationResult {
    if (this.fileContent.includes("invalid")) {
      return {
        success: false,
        error: new Error("Content contains invalid text"),
      };
    }
    return {
      success: true,
      error: undefined,
    };
  }

  static async fromFile(params: ToolCommandFromFileParams): Promise<TestToolCommand> {
    // Parse the relativeFilePath to extract directory and file components
    const pathParts = params.relativeFilePath.split("/");
    const fileName = pathParts.pop() || params.relativeFilePath;
    const relativeDirPath = pathParts.length > 0 ? pathParts.join("/") : ".";
    return new TestToolCommand({
      baseDir: params.baseDir || ".",
      relativeDirPath: relativeDirPath,
      relativeFilePath: fileName,
      fileContent: "test content from file",
    });
  }

  static fromRulesyncCommand(params: ToolCommandFromRulesyncCommandParams): TestToolCommand {
    return new TestToolCommand({
      baseDir: params.baseDir || ".",
      relativeDirPath: ".test",
      relativeFilePath: "test-command.md",
      fileContent: `Test command body: ${params.rulesyncCommand.getFileContent()}`,
    });
  }

  toRulesyncCommand(): RulesyncCommand {
    const mockRulesyncCommand = {
      getFileContent: () => this.fileContent.replace("Test command body: ", ""),
      getRelativeDirPath: () => ".rulesync",
      getRelativeFilePath: () => "converted-command.md",
      validate: () => ({ success: true, error: undefined }),
    } as unknown as RulesyncCommand;
    return mockRulesyncCommand;
  }
}

// Another test implementation to test abstract nature
class AnotherTestToolCommand extends ToolCommand {
  validate(): ValidationResult {
    return { success: true, error: undefined };
  }

  toRulesyncCommand(): RulesyncCommand {
    const mockRulesyncCommand = {
      getFileContent: () => "another test content",
      getRelativeDirPath: () => ".rulesync",
      getRelativeFilePath: () => "another-command.md",
      validate: () => ({ success: true, error: undefined }),
    } as unknown as RulesyncCommand;
    return mockRulesyncCommand;
  }
}

describe("ToolCommand", () => {
  describe("inheritance from AiFile", () => {
    it("should inherit all AiFile functionality", () => {
      const command = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "command.md",
        fileContent: "Tool command content",
      });

      // Should have all AiFile methods
      expect(command.getRelativeDirPath()).toBe(".tool");
      expect(command.getRelativeFilePath()).toBe("command.md");
      expect(command.getFileContent()).toBe("Tool command content");
      expect(typeof command.getFilePath).toBe("function");
      expect(typeof command.validate).toBe("function");
    });

    it("should support validation inheritance", () => {
      const validCommand = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "valid.md",
        fileContent: "Valid command content",
      });

      const invalidCommand = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "invalid-file.md",
        fileContent: "invalid content",
        validate: false, // Skip validation during construction
      });

      const validResult = validCommand.validate();
      const invalidResult = invalidCommand.validate();

      expect(validResult.success).toBe(true);
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toBeInstanceOf(Error);
    });

    it("should throw validation error during construction if content is invalid", () => {
      expect(() => {
        new TestToolCommand({
          relativeDirPath: ".tool",
          relativeFilePath: "invalid-file.md",
          fileContent: "invalid content",
        });
      }).toThrow("Content contains invalid text");
    });
  });

  describe("abstract nature", () => {
    it("should be abstract and require subclass implementation", () => {
      // Cannot instantiate ToolCommand directly due to abstract nature
      // This is verified by TypeScript compilation
      expect(TestToolCommand).toBeDefined();
      expect(AnotherTestToolCommand).toBeDefined();
    });

    it("should require toRulesyncCommand implementation in subclasses", () => {
      const command = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "test.md",
        fileContent: "test content",
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand).toBeDefined();
      expect(rulesyncCommand.getFileContent()).toBe("test content");
      expect(rulesyncCommand.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("converted-command.md");
    });
  });

  describe("static fromFile method", () => {
    it("should throw error when called on base ToolCommand class", async () => {
      const params: ToolCommandFromFileParams = {
        baseDir: ".",
        relativeFilePath: ".tool/command.md",
      };

      await expect(ToolCommand.fromFile(params)).rejects.toThrow(
        "Please implement this method in the subclass.",
      );
    });

    it("should work when implemented in subclass", async () => {
      const params: ToolCommandFromFileParams = {
        baseDir: "/test",
        relativeFilePath: ".tool/command.md",
      };

      const command = await TestToolCommand.fromFile(params);

      expect(command).toBeInstanceOf(TestToolCommand);
      expect(command.getBaseDir()).toBe("/test");
      expect(command.getRelativeDirPath()).toBe(".tool");
      expect(command.getRelativeFilePath()).toBe("command.md");
      expect(command.getFileContent()).toBe("test content from file");
    });

    it("should handle default baseDir in subclass implementation", async () => {
      const params: ToolCommandFromFileParams = {
        relativeFilePath: ".tool/command.md",
      };

      const command = await TestToolCommand.fromFile(params);

      expect(command.getBaseDir()).toBe(".");
      expect(command.getRelativeDirPath()).toBe(".tool");
      expect(command.getRelativeFilePath()).toBe("command.md");
    });

    it("should handle files in root directory", async () => {
      const params: ToolCommandFromFileParams = {
        relativeFilePath: "command.md",
      };

      const command = await TestToolCommand.fromFile(params);

      expect(command.getBaseDir()).toBe(".");
      expect(command.getRelativeDirPath()).toBe(".");
      expect(command.getRelativeFilePath()).toBe("command.md");
    });
  });

  describe("static fromRulesyncCommand method", () => {
    it("should throw error when called on base ToolCommand class", () => {
      const mockRulesyncCommand = {
        getFileContent: () => "rulesync content",
        getRelativeDirPath: () => ".rulesync",
        getRelativeFilePath: () => "sync.md",
      } as unknown as RulesyncCommand;

      const params: ToolCommandFromRulesyncCommandParams = {
        baseDir: ".",
        rulesyncCommand: mockRulesyncCommand,
      };

      expect(() => ToolCommand.fromRulesyncCommand(params)).toThrow(
        "Please implement this method in the subclass.",
      );
    });

    it("should work when implemented in subclass", () => {
      const mockRulesyncCommand = {
        getFileContent: () => "rulesync content",
        getRelativeDirPath: () => ".rulesync",
        getRelativeFilePath: () => "sync.md",
      } as unknown as RulesyncCommand;

      const params: ToolCommandFromRulesyncCommandParams = {
        baseDir: "/test",
        rulesyncCommand: mockRulesyncCommand,
      };

      const command = TestToolCommand.fromRulesyncCommand(params);

      expect(command).toBeInstanceOf(TestToolCommand);
      expect(command.getBaseDir()).toBe("/test");
      expect(command.getRelativeDirPath()).toBe(".test");
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getFileContent()).toBe("Test command body: rulesync content");
    });

    it("should handle default baseDir in subclass implementation", () => {
      const mockRulesyncCommand = {
        getFileContent: () => "rulesync content",
        getRelativeDirPath: () => ".rulesync",
        getRelativeFilePath: () => "sync.md",
      } as unknown as RulesyncCommand;

      const params: ToolCommandFromRulesyncCommandParams = {
        rulesyncCommand: mockRulesyncCommand,
      };

      const command = TestToolCommand.fromRulesyncCommand(params);

      expect(command.getBaseDir()).toBe(".");
    });

    it("should properly transform RulesyncCommand data", () => {
      const mockRulesyncCommand = {
        getFileContent: () => "original rulesync content",
        getRelativeDirPath: () => ".rulesync",
        getRelativeFilePath: () => "original.md",
      } as unknown as RulesyncCommand;

      const params: ToolCommandFromRulesyncCommandParams = {
        baseDir: "/project",
        rulesyncCommand: mockRulesyncCommand,
      };

      const command = TestToolCommand.fromRulesyncCommand(params);

      expect(command.getFileContent()).toContain("original rulesync content");
      expect(command.getFileContent()).toContain("Test command body:");
    });
  });

  describe("toRulesyncCommand method", () => {
    it("should convert ToolCommand back to RulesyncCommand", () => {
      const command = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "command.md",
        fileContent: "tool command content",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeDefined();
      expect(rulesyncCommand.getFileContent()).toBe("tool command content");
      expect(rulesyncCommand.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("converted-command.md");
      expect(rulesyncCommand.validate().success).toBe(true);
    });

    it("should work with different subclass implementations", () => {
      const command = new AnotherTestToolCommand({
        relativeDirPath: ".another",
        relativeFilePath: "another.md",
        fileContent: "another content",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeDefined();
      expect(rulesyncCommand.getFileContent()).toBe("another test content");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("another-command.md");
    });
  });

  describe("type definitions", () => {
    it("should have proper ToolCommandFromFileParams type", () => {
      const params: ToolCommandFromFileParams = {
        baseDir: "/test",
        relativeFilePath: ".tool/command.md",
      };

      expect(params.baseDir).toBe("/test");
      expect(params.relativeFilePath).toBe(".tool/command.md");
    });

    it("should have proper ToolCommandFromRulesyncCommandParams type", () => {
      const mockRulesyncCommand = {
        getFileContent: () => "test",
      } as unknown as RulesyncCommand;

      const params: ToolCommandFromRulesyncCommandParams = {
        baseDir: "/test",
        rulesyncCommand: mockRulesyncCommand,
      };

      expect(params.baseDir).toBe("/test");
      expect(params.rulesyncCommand).toBe(mockRulesyncCommand);

      // Should not have fileContent, relativeFilePath, or relativeDirPath from AiFileParams
      expect("fileContent" in params).toBe(false);
      expect("relativeFilePath" in params).toBe(false);
      expect("relativeDirPath" in params).toBe(false);
    });
  });

  describe("integration scenarios", () => {
    it("should support round-trip conversion: ToolCommand -> RulesyncCommand -> ToolCommand", () => {
      const originalCommand = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "original.md",
        fileContent: "original content",
      });

      const rulesyncCommand = originalCommand.toRulesyncCommand();
      const convertedCommand = TestToolCommand.fromRulesyncCommand({
        rulesyncCommand: rulesyncCommand,
      });

      expect(convertedCommand).toBeInstanceOf(TestToolCommand);
      expect(convertedCommand.getFileContent()).toContain("original content");
    });

    it("should maintain inheritance hierarchy", () => {
      const testCommand = new TestToolCommand({
        relativeDirPath: ".test",
        relativeFilePath: "test.md",
        fileContent: "test content",
      });

      const anotherCommand = new AnotherTestToolCommand({
        relativeDirPath: ".another",
        relativeFilePath: "another.md",
        fileContent: "another content",
      });

      expect(testCommand).toBeInstanceOf(ToolCommand);
      expect(anotherCommand).toBeInstanceOf(ToolCommand);
      expect(testCommand).toBeInstanceOf(TestToolCommand);
      expect(anotherCommand).toBeInstanceOf(AnotherTestToolCommand);
    });
  });

  describe("error handling", () => {
    it("should handle validation errors properly", () => {
      expect(() => {
        new TestToolCommand({
          relativeDirPath: ".tool",
          relativeFilePath: "test.md",
          fileContent: "invalid content",
        });
      }).toThrow("Content contains invalid text");
    });

    it("should allow construction with validation disabled", () => {
      const command = new TestToolCommand({
        relativeDirPath: ".tool",
        relativeFilePath: "test.md",
        fileContent: "invalid content",
        validate: false,
      });

      expect(command).toBeInstanceOf(TestToolCommand);
      expect(command.getFileContent()).toBe("invalid content");

      // But validation should still fail when called explicitly
      const result = command.validate();
      expect(result.success).toBe(false);
    });
  });
});
