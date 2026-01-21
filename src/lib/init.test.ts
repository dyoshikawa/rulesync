import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { directoryExists, fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { init } from "./init.js";

// These tests use process.chdir() because lib functions use relative paths
// that must resolve against the actual working directory for fs operations.
// This is acceptable per testing guidelines as these are integration tests.
describe("init", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    ({ testDir, cleanup } = await setupTestDirectory());
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanup();
  });

  describe("directory creation", () => {
    it("should create .rulesync directory", async () => {
      await init();

      expect(await directoryExists(join(testDir, ".rulesync"))).toBe(true);
    });

    it("should create rules directory", async () => {
      await init();

      expect(await directoryExists(join(testDir, ".rulesync", "rules"))).toBe(true);
    });

    it("should create commands directory", async () => {
      await init();

      expect(await directoryExists(join(testDir, ".rulesync", "commands"))).toBe(true);
    });

    it("should create subagents directory", async () => {
      await init();

      expect(await directoryExists(join(testDir, ".rulesync", "subagents"))).toBe(true);
    });

    it("should create skills directory", async () => {
      await init();

      expect(await directoryExists(join(testDir, ".rulesync", "skills"))).toBe(true);
    });
  });

  describe("sample files", () => {
    it("should create sample rule file", async () => {
      await init();

      const ruleFile = join(testDir, ".rulesync", "rules", "overview.md");
      expect(await fileExists(ruleFile)).toBe(true);

      const content = await readFileContent(ruleFile);
      expect(content).toContain("root: true");
      expect(content).toContain("# Project Overview");
    });

    it("should create sample mcp file", async () => {
      await init();

      const mcpFile = join(testDir, ".rulesync", "mcp.json");
      expect(await fileExists(mcpFile)).toBe(true);

      const content = await readFileContent(mcpFile);
      expect(content).toContain("mcpServers");
    });

    it("should create sample command file", async () => {
      await init();

      const commandFile = join(testDir, ".rulesync", "commands", "review-pr.md");
      expect(await fileExists(commandFile)).toBe(true);

      const content = await readFileContent(commandFile);
      expect(content).toContain("description:");
      expect(content).toContain("Review a pull request");
    });

    it("should create sample subagent file", async () => {
      await init();

      const subagentFile = join(testDir, ".rulesync", "subagents", "planner.md");
      expect(await fileExists(subagentFile)).toBe(true);

      const content = await readFileContent(subagentFile);
      expect(content).toContain("name: planner");
    });

    it("should create sample skill file", async () => {
      await init();

      const skillFile = join(testDir, ".rulesync", "skills", "project-context", "SKILL.md");
      expect(await fileExists(skillFile)).toBe(true);

      const content = await readFileContent(skillFile);
      expect(content).toContain("name: project-context");
    });

    it("should create sample ignore file", async () => {
      await init();

      const ignoreFile = join(testDir, ".rulesync", ".aiignore");
      expect(await fileExists(ignoreFile)).toBe(true);

      const content = await readFileContent(ignoreFile);
      expect(content).toContain("credentials/");
    });
  });

  describe("config file", () => {
    it("should create rulesync.jsonc config file", async () => {
      await init();

      const configFile = join(testDir, "rulesync.jsonc");
      expect(await fileExists(configFile)).toBe(true);

      const content = await readFileContent(configFile);
      const config = JSON.parse(content);
      expect(config.targets).toContain("claudecode");
      expect(config.features).toContain("rules");
    });

    it("should not overwrite existing config file", async () => {
      const existingContent = '{"targets": ["cursor"]}';
      await writeFileContent(join(testDir, "rulesync.jsonc"), existingContent);

      await init();

      const content = await readFileContent(join(testDir, "rulesync.jsonc"));
      expect(content).toBe(existingContent);
    });
  });

  describe("idempotency", () => {
    it("should not overwrite existing rule file", async () => {
      await init();

      const ruleFile = join(testDir, ".rulesync", "rules", "overview.md");
      const customContent = "# Custom Content";
      await writeFileContent(ruleFile, customContent);

      await init();

      const content = await readFileContent(ruleFile);
      expect(content).toBe(customContent);
    });

    it("should not overwrite existing mcp file", async () => {
      await init();

      const mcpFile = join(testDir, ".rulesync", "mcp.json");
      const customContent = '{"mcpServers": {}}';
      await writeFileContent(mcpFile, customContent);

      await init();

      const content = await readFileContent(mcpFile);
      expect(content).toBe(customContent);
    });

    it("should not overwrite existing command file", async () => {
      await init();

      const commandFile = join(testDir, ".rulesync", "commands", "review-pr.md");
      const customContent = "# Custom Command";
      await writeFileContent(commandFile, customContent);

      await init();

      const content = await readFileContent(commandFile);
      expect(content).toBe(customContent);
    });

    it("should not overwrite existing subagent file", async () => {
      await init();

      const subagentFile = join(testDir, ".rulesync", "subagents", "planner.md");
      const customContent = "# Custom Subagent";
      await writeFileContent(subagentFile, customContent);

      await init();

      const content = await readFileContent(subagentFile);
      expect(content).toBe(customContent);
    });

    it("should not overwrite existing skill file", async () => {
      await init();

      const skillFile = join(testDir, ".rulesync", "skills", "project-context", "SKILL.md");
      const customContent = "# Custom Skill";
      await writeFileContent(skillFile, customContent);

      await init();

      const content = await readFileContent(skillFile);
      expect(content).toBe(customContent);
    });

    it("should not overwrite existing ignore file", async () => {
      await init();

      const ignoreFile = join(testDir, ".rulesync", ".aiignore");
      const customContent = "custom-ignore/";
      await writeFileContent(ignoreFile, customContent);

      await init();

      const content = await readFileContent(ignoreFile);
      expect(content).toBe(customContent);
    });

    it("should be safe to call multiple times", async () => {
      await init();
      await init();
      await init();

      expect(await directoryExists(join(testDir, ".rulesync"))).toBe(true);
      expect(await fileExists(join(testDir, ".rulesync", "rules", "overview.md"))).toBe(true);
    });
  });
});
