import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as fileUtils from "../utils/file.js";
import { parseJunieConfiguration } from "./junie.js";

// Mock file utilities
vi.mock("../utils/file.js", () => ({
  fileExists: vi.fn(),
  readFileContent: vi.fn(),
}));

const mockFileExists = vi.mocked(fileUtils.fileExists);
const mockReadFileContent = vi.mocked(fileUtils.readFileContent);

describe("parseJunieConfiguration", () => {
  const baseDir = "/test/project";

  it("should parse .junie/guidelines.md successfully", async () => {
    vi.clearAllMocks();
    const guidelinesContent = `# Project Guidelines

## Tech Stack
- TypeScript
- React

## Coding Standards
1. Use functional components
2. Write tests for all features`;

    mockFileExists.mockImplementation((path: string) => {
      return Promise.resolve(path === join(baseDir, ".junie", "guidelines.md"));
    });

    mockReadFileContent.mockResolvedValue(guidelinesContent);

    const result = await parseJunieConfiguration(baseDir);

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0];
    expect(rule?.frontmatter.targets).toEqual(["junie"]);
    expect(rule?.frontmatter.description).toBe("Junie project guidelines");
    expect(rule?.frontmatter.globs).toEqual(["**/*"]);
    expect(rule?.content).toBe(guidelinesContent);
    expect(rule?.filename).toBe("junie-guidelines");
  });

  it("should return error when .junie/guidelines.md does not exist", async () => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(false);

    const result = await parseJunieConfiguration(baseDir);

    expect(result.errors).toEqual([".junie/guidelines.md file not found"]);
    expect(result.rules).toHaveLength(0);
  });

  it("should handle file read errors", async () => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockReadFileContent.mockRejectedValue(new Error("Permission denied"));

    const result = await parseJunieConfiguration(baseDir);

    expect(result.errors).toEqual([
      "Failed to parse .junie/guidelines.md: Permission denied",
      "No valid Junie configuration found",
    ]);
    expect(result.rules).toHaveLength(0);
  });

  it("should handle empty file content", async () => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockReadFileContent.mockResolvedValue("   \n  \n   ");

    const result = await parseJunieConfiguration(baseDir);

    expect(result.errors).toEqual(["No valid Junie configuration found"]);
    expect(result.rules).toHaveLength(0);
  });

  it("should use default baseDir when not provided", async () => {
    vi.clearAllMocks();
    mockFileExists.mockImplementation((path: string) => {
      return Promise.resolve(path.endsWith(".junie/guidelines.md"));
    });
    mockReadFileContent.mockResolvedValue("# Guidelines");

    const result = await parseJunieConfiguration();

    expect(result.errors).toHaveLength(0);
    expect(result.rules).toHaveLength(1);
    expect(mockFileExists).toHaveBeenCalled();
  });
});
