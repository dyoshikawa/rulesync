import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
import { loadConfig } from "../../utils/config-loader.js";
import { logger } from "../../utils/logger.js";
import { addCommand } from "./add.js";

vi.mock("node:fs/promises");
vi.mock("../../utils/config-loader.js");

const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);
const mockLoadConfig = vi.mocked(loadConfig);

const mockConfig = createMockConfig();

describe("addCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue({ config: mockConfig, isEmpty: false });
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue();

    // Mock logger methods
    vi.spyOn(logger, "success").mockImplementation(() => {});
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("should create a rule file successfully", async () => {
    await addCommand("test-rule");

    expect(mockMkdir).toHaveBeenCalledWith(".rulesync/rules", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(".rulesync/rules", "test-rule.md"),
      expect.stringContaining("root: false"),
      "utf8",
    );
    expect(logger.success).toHaveBeenCalledWith(
      `Created rule file: ${path.join(".rulesync/rules", "test-rule.md")}`,
    );
    expect(logger.log).toHaveBeenCalledWith("📝 Edit the file to customize your rules.");
  });

  it("should remove .md extension from filename", async () => {
    await addCommand("test-rule.md");

    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(".rulesync/rules", "test-rule.md"),
      expect.stringContaining('description: "Rules for test-rule"'),
      "utf8",
    );
  });

  it("should generate proper template content", async () => {
    await addCommand("typescript-rules");

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(
        /---\nroot: false\ntargets: \["\*"\]\ndescription: "Rules for typescript-rules"\nglobs: \[\]\n---\n\n# Typescript-rules Rules\n\nAdd your rules here\.\n/,
      ),
      "utf8",
    );
  });

  it("should handle mkdir errors gracefully", async () => {
    const error = new Error("Permission denied");
    mockMkdir.mockRejectedValue(error);

    await expect(addCommand("test-rule")).rejects.toThrow("process.exit called");
    expect(logger.error).toHaveBeenCalledWith("Failed to create rule file: Permission denied");
  });

  it("should handle writeFile errors gracefully", async () => {
    const error = new Error("Disk full");
    mockWriteFile.mockRejectedValue(error);

    await expect(addCommand("test-rule")).rejects.toThrow("process.exit called");
    expect(logger.error).toHaveBeenCalledWith("Failed to create rule file: Disk full");
  });

  it("should handle non-Error exceptions", async () => {
    mockWriteFile.mockRejectedValue("String error");

    await expect(addCommand("test-rule")).rejects.toThrow("process.exit called");
    expect(logger.error).toHaveBeenCalledWith("Failed to create rule file: String error");
  });

  it("should capitalize first letter in template", async () => {
    await addCommand("myRule");

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("# MyRule Rules"),
      "utf8",
    );
  });

  it("should use legacy location when --legacy option is provided", async () => {
    await addCommand("test-rule", { legacy: true });

    expect(mockMkdir).toHaveBeenCalledWith(".rulesync", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(".rulesync", "test-rule.md"),
      expect.stringContaining("root: false"),
      "utf8",
    );
  });

  it("should use legacy location when config.legacy is true", async () => {
    const legacyMockConfig = { ...mockConfig, legacy: true };
    mockLoadConfig.mockResolvedValue({ config: legacyMockConfig, isEmpty: false });

    await addCommand("test-rule");

    expect(mockMkdir).toHaveBeenCalledWith(".rulesync", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(".rulesync", "test-rule.md"),
      expect.stringContaining("root: false"),
      "utf8",
    );
  });
});
