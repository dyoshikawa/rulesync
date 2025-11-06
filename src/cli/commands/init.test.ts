import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { initCommand } from "./init.js";

describe("initCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let originalCwd: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanup();
  });

  describe("basic functionality", () => {
    it("should initialize rulesync successfully", async () => {
      await initCommand();

      // Verify that directories were created
      expect(await fileExists(".rulesync")).toBe(true);
      expect(await fileExists(".rulesync/rules")).toBe(true);
      expect(await fileExists(".rulesync/commands")).toBe(true);
      expect(await fileExists(".rulesync/subagents")).toBe(true);
    });

    it("should create required directories", async () => {
      await initCommand();

      // Verify all directories exist
      expect(await fileExists(".rulesync")).toBe(true);
      expect(await fileExists(".rulesync/rules")).toBe(true);
      expect(await fileExists(".rulesync/commands")).toBe(true);
      expect(await fileExists(".rulesync/subagents")).toBe(true);
    });

    it("should create sample files", async () => {
      await initCommand();

      // Verify that sample files were created
      const ruleFile = ".rulesync/rules/overview.md";
      const mcpFile = ".rulesync/mcp.json";
      const commandFile = ".rulesync/commands/review-pr.md";
      const subagentFile = ".rulesync/subagents/planner.md";
      const ignoreFile = ".rulesyncignore";
      const configFile = "rulesync.jsonc";

      expect(await fileExists(ruleFile)).toBe(true);
      expect(await fileExists(mcpFile)).toBe(true);
      expect(await fileExists(commandFile)).toBe(true);
      expect(await fileExists(subagentFile)).toBe(true);
      expect(await fileExists(ignoreFile)).toBe(true);
      expect(await fileExists(configFile)).toBe(true);
    });
  });

  describe("sample file creation", () => {
    it("should create overview.md sample file when it doesn't exist", async () => {
      await initCommand();

      const ruleFile = ".rulesync/rules/overview.md";
      expect(await fileExists(ruleFile)).toBe(true);

      const content = await readFileContent(ruleFile);
      expect(content).toContain("# Project Overview");
    });

    it("should skip creating overview.md when it already exists", async () => {
      // Run initCommand twice
      await initCommand();
      await initCommand();

      // Verify file still exists and wasn't overwritten
      const ruleFile = ".rulesync/rules/overview.md";
      expect(await fileExists(ruleFile)).toBe(true);
    });

    it("should create sample file with correct content structure", async () => {
      await initCommand();

      const ruleFile = ".rulesync/rules/overview.md";
      const content = await readFileContent(ruleFile);

      // Check frontmatter
      expect(content).toMatch(/^---\s*$/m);
      expect(content).toContain("root: true");
      expect(content).toContain('targets: ["*"]');
      expect(content).toContain(
        'description: "Project overview and general development guidelines"',
      );
      expect(content).toContain('globs: ["**/*"]');

      // Check content sections
      expect(content).toContain("# Project Overview");
      expect(content).toContain("## General Guidelines");
      expect(content).toContain("## Code Style");
      expect(content).toContain("## Architecture Principles");

      // Check specific guidelines
      expect(content).toContain("Use TypeScript for all new code");
      expect(content).toContain("Use 2 spaces for indentation");
      expect(content).toContain("Organize code by feature, not by file type");
    });

    it("should create sample file with proper formatting", async () => {
      await initCommand();

      const ruleFile = ".rulesync/rules/overview.md";
      const content = await readFileContent(ruleFile);

      // Check that content is properly formatted
      expect(content).toMatch(/^---[\s\S]*---[\s\S]*# Project Overview/);
      expect(content.split("\n").length).toBeGreaterThan(10); // Should be multiline
      expect(content).toContain("\n\n"); // Should have proper spacing
    });
  });

  describe("integration scenarios", () => {
    it("should work correctly when run multiple times", async () => {
      // Run initCommand twice
      await initCommand();
      await initCommand();

      // Verify all files still exist
      expect(await fileExists(".rulesync")).toBe(true);
      expect(await fileExists(".rulesync/rules")).toBe(true);
      expect(await fileExists(".rulesync/commands")).toBe(true);
      expect(await fileExists(".rulesync/subagents")).toBe(true);
      expect(await fileExists(".rulesync/rules/overview.md")).toBe(true);
      expect(await fileExists(".rulesync/mcp.json")).toBe(true);
      expect(await fileExists("rulesync.jsonc")).toBe(true);
    });

    it("should create all sample files with expected content", async () => {
      await initCommand();

      // Verify rule file
      const ruleContent = await readFileContent(".rulesync/rules/overview.md");
      expect(ruleContent).toContain("# Project Overview");

      // Verify MCP file
      const mcpContent = await readFileContent(".rulesync/mcp.json");
      expect(mcpContent).toContain("mcpServers");

      // Verify command file
      const commandContent = await readFileContent(".rulesync/commands/review-pr.md");
      expect(commandContent).toContain("Review a pull request");

      // Verify subagent file
      const subagentContent = await readFileContent(".rulesync/subagents/planner.md");
      expect(subagentContent).toContain("planner");

      // Verify ignore file
      const ignoreContent = await readFileContent(".rulesyncignore");
      expect(ignoreContent).toContain("credentials/");

      // Verify config file
      const configContent = await readFileContent("rulesync.jsonc");
      expect(configContent).toContain("targets");
    });
  });
});
