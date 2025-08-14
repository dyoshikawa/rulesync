import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRulesFromDirectory } from "../../core/index.js";
import { createMockConfig } from "../../test-utils/index.js";
import type { ParsedRule } from "../../types/index.js";
import { fileExists, getDefaultConfig } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";
import { statusCommand } from "./status.js";

vi.mock("../../core/index.js");
vi.mock("../../utils/index.js");

const mockParseRulesFromDirectory = vi.mocked(parseRulesFromDirectory);
const mockFileExists = vi.mocked(fileExists);
const mockGetDefaultConfig = vi.mocked(getDefaultConfig);

const mockConfig = createMockConfig();

const mockRules: ParsedRule[] = [
  {
    filename: "rule1",
    filepath: ".rulesync/rule1.md",
    frontmatter: {
      targets: ["*"],
      root: true,
      description: "Rule 1",
      globs: ["**/*.ts"],
    },
    content: "Rule 1 content",
  },
  {
    filename: "rule2",
    filepath: ".rulesync/rule2.md",
    frontmatter: {
      targets: ["copilot", "cursor"],
      root: false,
      description: "Rule 2",
      globs: ["**/*.js"],
    },
    content: "Rule 2 content",
  },
];

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);

    // Mock console methods
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  it("should show status when .rulesync directory exists", async () => {
    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("rulesync Status");
    expect(logger.log).toHaveBeenCalledWith("===============");
    expect(logger.log).toHaveBeenCalledWith("\n📁 .rulesync directory: ✅ Found");
    expect(logger.log).toHaveBeenCalledWith("\n📋 Rules: 2 total");
  });

  it("should show message when .rulesync directory does not exist", async () => {
    mockFileExists.mockImplementation(async (path) => {
      return path !== ".rulesync";
    });

    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("\n📁 .rulesync directory: ❌ Not found");
    expect(logger.log).toHaveBeenCalledWith("\n💡 Run 'rulesync init' to get started");
    expect(mockParseRulesFromDirectory).not.toHaveBeenCalled();
  });

  it("should count rules by root status", async () => {
    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("   - Root rules: 1");
    expect(logger.log).toHaveBeenCalledWith("   - Non-root rules: 1");
  });

  it("should count target tool coverage", async () => {
    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("\n🎯 Target tool coverage:");
    expect(logger.log).toHaveBeenCalledWith("   - Copilot: 2 rules"); // rule1 (*) + rule2 (copilot)
    expect(logger.log).toHaveBeenCalledWith("   - Cursor: 2 rules"); // rule1 (*) + rule2 (cursor)
    expect(logger.log).toHaveBeenCalledWith("   - Cline: 1 rules"); // rule1 (*) only
  });

  it("should check generated files status", async () => {
    mockFileExists.mockImplementation(async (path) => {
      if (path === ".rulesync") return true;
      if (path === ".github/instructions") return true;
      if (path === ".cursor/rules") return false;
      return true;
    });

    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("\n📤 Generated files:");
    expect(logger.log).toHaveBeenCalledWith("   - copilot: ✅ Generated");
    expect(logger.log).toHaveBeenCalledWith("   - cursor: ❌ Not found");
    expect(logger.log).toHaveBeenCalledWith("   - cline: ✅ Generated");
  });

  it("should show generate suggestion when rules exist", async () => {
    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith(
      "\n💡 Run 'rulesync generate' to update configuration files",
    );
  });

  it("should not show generate suggestion when no rules exist", async () => {
    mockParseRulesFromDirectory.mockResolvedValue([]);

    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("\n📋 Rules: 0 total");
    expect(logger.log).not.toHaveBeenCalledWith(
      "\n💡 Run 'rulesync generate' to update configuration files",
    );
  });

  it("should handle parsing errors gracefully", async () => {
    const error = new Error("Parse error");
    mockParseRulesFromDirectory.mockRejectedValue(error);

    await statusCommand();

    expect(logger.error).toHaveBeenCalledWith("\nFailed to get status:", error);
  });

  it("should handle rules with root field correctly", async () => {
    const rulesWithRoot: ParsedRule[] = [
      {
        filename: "rule1",
        filepath: ".rulesync/rule1.md",
        frontmatter: {
          targets: ["*"],
          root: true,
          description: "Rule 1",
          globs: ["**/*.ts"],
        },
        content: "Rule 1 content",
      },
    ];
    mockParseRulesFromDirectory.mockResolvedValue(rulesWithRoot);

    await statusCommand();

    expect(logger.log).toHaveBeenCalledWith("   - Root rules: 1");
    expect(logger.log).toHaveBeenCalledWith("   - Non-root rules: 0");
  });
});
