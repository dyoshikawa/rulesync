import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRulesFromDirectory, validateRules } from "../../core/index.js";
import { createMockConfig } from "../../test-utils/index.js";
import { fileExists, getDefaultConfig } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";
import { validateCommand } from "./validate.js";

vi.mock("../../core/index.js");
vi.mock("../../utils/index.js");

const mockParseRulesFromDirectory = vi.mocked(parseRulesFromDirectory);
const mockValidateRules = vi.mocked(validateRules);
const mockFileExists = vi.mocked(fileExists);
const mockGetDefaultConfig = vi.mocked(getDefaultConfig);

const mockConfig = createMockConfig();

const mockRules = [
  {
    filename: "rule1",
    filepath: ".rulesync/rule1.md",
    frontmatter: {
      targets: ["*"] satisfies ["*"],
      root: true,
      description: "Rule 1",
      globs: ["**/*.ts"],
    },
    content: "Rule 1 content",
  },
];

describe("validateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);
    mockValidateRules.mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
    });

    // Mock logger methods
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "success").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("should validate rules successfully", async () => {
    await validateCommand();

    expect(logger.log).toHaveBeenCalledWith("Validating rulesync configuration...");
    expect(logger.log).toHaveBeenCalledWith("Found 1 rule(s), validating...");
    expect(logger.success).toHaveBeenCalledWith("\nAll rules are valid!");
    expect(mockValidateRules).toHaveBeenCalledWith(mockRules);
  });

  it("should exit if .rulesync directory does not exist", async () => {
    mockFileExists.mockResolvedValue(false);

    await expect(validateCommand()).rejects.toThrow("process.exit called");
    expect(logger.error).toHaveBeenCalledWith(
      ".rulesync directory not found. Run 'rulesync init' first.",
    );
  });

  it("should warn if no rules found", async () => {
    mockParseRulesFromDirectory.mockResolvedValue([]);

    await validateCommand();

    expect(logger.warn).toHaveBeenCalledWith("No rules found in .rulesync directory");
    expect(mockValidateRules).not.toHaveBeenCalled();
  });

  it("should display warnings", async () => {
    mockValidateRules.mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: ["Warning 1", "Warning 2"],
    });

    await validateCommand();

    expect(logger.log).toHaveBeenCalledWith("\n⚠️  Warnings:");
    expect(logger.log).toHaveBeenCalledWith("  - Warning 1");
    expect(logger.log).toHaveBeenCalledWith("  - Warning 2");
    expect(logger.success).toHaveBeenCalledWith("\nAll rules are valid!");
  });

  it("should display errors and exit", async () => {
    mockValidateRules.mockResolvedValue({
      isValid: false,
      errors: ["Error 1", "Error 2"],
      warnings: [],
    });

    await expect(validateCommand()).rejects.toThrow("process.exit called");

    expect(logger.log).toHaveBeenCalledWith("\nErrors:");
    expect(logger.log).toHaveBeenCalledWith("  - Error 1");
    expect(logger.log).toHaveBeenCalledWith("  - Error 2");
    expect(logger.log).toHaveBeenCalledWith("\nValidation failed with 2 error(s)");
  });

  it("should display both warnings and errors", async () => {
    mockValidateRules.mockResolvedValue({
      isValid: false,
      errors: ["Error 1"],
      warnings: ["Warning 1"],
    });

    await expect(validateCommand()).rejects.toThrow("process.exit called");

    expect(logger.log).toHaveBeenCalledWith("\n⚠️  Warnings:");
    expect(logger.log).toHaveBeenCalledWith("  - Warning 1");
    expect(logger.log).toHaveBeenCalledWith("\nErrors:");
    expect(logger.log).toHaveBeenCalledWith("  - Error 1");
  });

  it("should handle parsing errors gracefully", async () => {
    const error = new Error("Parse error");
    mockParseRulesFromDirectory.mockRejectedValue(error);

    await expect(validateCommand()).rejects.toThrow("process.exit called");
    expect(logger.error).toHaveBeenCalledWith("Failed to validate rules:", error);
  });

  it("should handle validation errors gracefully", async () => {
    const error = new Error("Validation error");
    mockValidateRules.mockRejectedValue(error);

    await expect(validateCommand()).rejects.toThrow("process.exit called");
    expect(logger.error).toHaveBeenCalledWith("Failed to validate rules:", error);
  });
});
