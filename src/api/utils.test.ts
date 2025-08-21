import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/index.js";
import { writeFileContent } from "../utils/file.js";
import { initialize } from "./core.js";
import { getSupportedTools, loadConfig, parseRules } from "./utils.js";

describe("API Utils Functions", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("parseRules", () => {
    beforeEach(async () => {
      await initialize({ baseDir: testDir });
    });

    it("should parse all rule files in project", async () => {
      // Add a custom rule file
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "custom.md"),
        `---
title: "Custom Rules"
description: "Custom development rules"
targets: ["cursor", "claudecode"]
---

# Custom Rules

- Use TypeScript
- Write tests`,
      );

      const result = await parseRules({
        baseDir: testDir,
      });

      expect(result.errors).toHaveLength(0);
      expect(result.rules.length).toBeGreaterThan(0);

      const customRule = result.rules.find((r) => r.filePath.includes("custom.md"));
      expect(customRule).toBeDefined();
      expect(customRule?.metadata.title).toBe("Custom Rules");
      expect(customRule?.metadata.targets).toEqual(["cursor", "claudecode"]);
    });

    it("should parse specific files when filePaths provided", async () => {
      const overviewPath = join(testDir, ".rulesync", "rules", "overview.md");

      const result = await parseRules({
        baseDir: testDir,
        filePaths: [overviewPath],
      });

      expect(result.errors).toHaveLength(0);
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]?.filePath).toBe(overviewPath);
    });

    it("should handle parsing errors gracefully", async () => {
      // Create a file with invalid frontmatter
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "invalid.md"),
        `---
invalid: yaml: content: [
---

# Invalid File`,
      );

      const result = await parseRules({
        baseDir: testDir,
      });

      // Should still return results, but with errors
      expect(result.errors.length).toBeGreaterThan(0);
      const error = result.errors.find((e) => e.filePath.includes("invalid.md"));
      expect(error).toBeDefined();
    });
  });

  describe("loadConfig", () => {
    it("should load default config when no config file exists", async () => {
      const config = await loadConfig({
        baseDir: testDir,
        mergeDefaults: true,
      });

      expect(config).toBeDefined();
      expect(config.aiRulesDir).toBe(".rulesync");
      expect(config.legacy).toBe(false);
    });

    it("should load and merge custom config", async () => {
      // Create a custom config file
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify(
          {
            aiRulesDir: ".custom-rules",
            verbose: true,
            targets: ["cursor", "claudecode"],
          },
          null,
          2,
        ),
      );

      const config = await loadConfig({
        baseDir: testDir,
        mergeDefaults: true,
      });

      expect(config.aiRulesDir).toBe(".custom-rules");
      expect(config.legacy).toBe(false); // Should still have defaults
    });

    it("should handle config without merging defaults", async () => {
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify(
          {
            aiRulesDir: ".custom-rules",
          },
          null,
          2,
        ),
      );

      const config = await loadConfig({
        baseDir: testDir,
        mergeDefaults: false,
      });

      expect(config.aiRulesDir).toBe(".custom-rules");
    });
  });

  describe("getSupportedTools", () => {
    it("should return information about all supported tools", () => {
      const tools = getSupportedTools();

      expect(tools.length).toBeGreaterThan(0);

      // Check that some key tools are included
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("cursor");
      expect(toolNames).toContain("claudecode");
      expect(toolNames).toContain("copilot");
      expect(toolNames).toContain("cline");
    });

    it("should include correct feature information", () => {
      const tools = getSupportedTools();

      const cursorTool = tools.find((t) => t.name === "cursor");
      expect(cursorTool).toBeDefined();
      expect(cursorTool?.features.rules).toBe(true);
      expect(cursorTool?.features.mcp).toBe(true);
      expect(cursorTool?.configPaths.rules).toEqual([".cursorrules"]);

      const claudecodeTool = tools.find((t) => t.name === "claudecode");
      expect(claudecodeTool).toBeDefined();
      expect(claudecodeTool?.features.commands).toBe(true);
      expect(claudecodeTool?.configPaths.commands).toEqual([".claude/commands/"]);
    });

    it("should include display names and descriptions", () => {
      const tools = getSupportedTools();

      for (const tool of tools) {
        expect(tool.displayName).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.name).toBeTruthy();
      }
    });
  });
});
