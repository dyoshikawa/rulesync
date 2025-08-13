import { vi } from "vitest";

/**
 * Common mock setup patterns for CLI command tests
 */
/* eslint-disable @typescript-eslint/no-extraneous-class */
// biome-ignore lint/complexity/noStaticOnlyClass: utility class pattern is preferred here
export class TestMockHelpers {
  /**
   * Setup common console mocks for CLI tests
   */
  static setupConsoleMocks() {
    const originalExit = process.exit;

    const mocks = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      exit: vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      }),
    };

    return {
      ...mocks,
      cleanup: () => {
        // Restore original process.exit for proper test cleanup
        process.exit = originalExit;
        Object.values(mocks).forEach((mock) => mock.mockRestore());
      },
    };
  }

  /**
   * Create a mock file system error
   */
  static createFileSystemError(message: string, code?: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = Object.assign(new Error(message), {
      code: code,
    });
    if (code) {
      error.code = code;
    }
    return error;
  }

  /**
   * Mock successful file operations
   */
  static mockFileOperationsSuccess() {
    return {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue("mock content"),
      fileExists: vi.fn().mockResolvedValue(true),
    };
  }

  /**
   * Mock file operations with errors
   */
  static mockFileOperationsWithError(
    errorMessage: string,
    operation: "mkdir" | "writeFile" | "readFile",
  ) {
    const mocks = this.mockFileOperationsSuccess();
    const error = this.createFileSystemError(errorMessage);

    switch (operation) {
      case "mkdir":
        mocks.mkdir.mockRejectedValue(error);
        break;
      case "writeFile":
        mocks.writeFile.mockRejectedValue(error);
        break;
      case "readFile":
        mocks.readFile.mockRejectedValue(error);
        break;
    }

    return mocks;
  }

  /**
   * Create common test rule data
   */
  static createMockRule(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      filename: "test-rule",
      filepath: ".rulesync/test-rule.md",
      frontmatter: {
        targets: ["*"] as const,
        root: false,
        description: "Test rule",
        globs: ["**/*.ts"],
      },
      content: "Test rule content",
      ...overrides,
    };
  }

  /**
   * Create multiple mock rules
   */
  static createMockRules(count: number, baseOverrides: Partial<Record<string, unknown>> = {}) {
    return Array.from({ length: count }, (_, i) =>
      this.createMockRule({
        filename: `rule-${i + 1}`,
        filepath: `.rulesync/rule-${i + 1}.md`,
        frontmatter: {
          ...(baseOverrides.frontmatter as Record<string, unknown>),
          description: `Rule ${i + 1}`,
        },
        content: `Rule ${i + 1} content`,
        ...baseOverrides,
      }),
    );
  }

  /**
   * Create mock validation result
   */
  static createMockValidationResult(
    overrides: Partial<{
      isValid: boolean;
      errors: string[];
      warnings: string[];
    }> = {},
  ) {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      ...overrides,
    };
  }
}
