import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { executeGenerate, type McpGenerateResult } from "./generate.js";

describe("MCP Generate Tools", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("executeGenerate", () => {
    it("should return error when .rulesync directory does not exist", async () => {
      const result = await executeGenerate();

      expect(result.success).toBe(false);
      expect(result.error).toContain(".rulesync directory does not exist");
    });

    it("should execute generate with default config", async () => {
      // Create .rulesync directory and a sample rule
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      await writeFileContent(
        join(rulesDir, "overview.md"),
        `---
root: true
targets: ["*"]
description: "Test rule"
---
# Test Rule`,
      );

      const result = await executeGenerate();

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.totalCount).toBeGreaterThanOrEqual(0);
      expect(result.config).toBeDefined();
    });

    it("should use rulesync.jsonc settings when no options provided", async () => {
      // Create .rulesync directory
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      // Create rulesync.jsonc with specific settings
      await writeFileContent(
        join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
        JSON.stringify({
          targets: ["claudecode"],
          features: ["rules"],
          delete: false,
        }),
      );

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await executeGenerate();

      expect(result.success).toBe(true);
      expect(result.config?.targets).toContain("claudecode");
      expect(result.config?.features).toContain("rules");
    });

    it("should override config with MCP options", async () => {
      // Create .rulesync directory
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      // Create rulesync.jsonc with default settings
      await writeFileContent(
        join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
        JSON.stringify({
          targets: ["agentsmd"],
          features: ["rules"],
        }),
      );

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      // Override with MCP options
      const result = await executeGenerate({
        targets: ["cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.config?.targets).toContain("cursor");
      expect(result.config?.features).toContain("rules");
    });

    it("should handle wildcard targets", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await executeGenerate({
        targets: ["*"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      // Wildcard should expand to multiple targets
      expect(result.config?.targets.length).toBeGreaterThan(1);
    });

    it("should handle wildcard features", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["agentsmd"]
---
# Overview`,
      );

      const result = await executeGenerate({
        targets: ["agentsmd"],
        features: ["*"],
      });

      expect(result.success).toBe(true);
      // Wildcard should expand to multiple features
      expect(result.config?.features.length).toBeGreaterThan(1);
    });

    it("should return generation counts in result", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await executeGenerate({
        targets: ["agentsmd"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        rulesCount: expect.any(Number),
        ignoreCount: expect.any(Number),
        mcpCount: expect.any(Number),
        commandsCount: expect.any(Number),
        subagentsCount: expect.any(Number),
        skillsCount: expect.any(Number),
        hooksCount: expect.any(Number),
        totalCount: expect.any(Number),
      });
    });

    it("should return config in result", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await executeGenerate({
        targets: ["agentsmd"],
        features: ["rules"],
        delete: true,
        simulateCommands: true,
      });

      expect(result.success).toBe(true);
      expect(result.config).toMatchObject({
        targets: expect.any(Array),
        features: expect.any(Array),
        global: expect.any(Boolean),
        delete: true,
        simulateCommands: true,
        simulateSubagents: expect.any(Boolean),
        simulateSkills: expect.any(Boolean),
        modularMcp: expect.any(Boolean),
      });
    });

    it("should handle simulation options", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));
      await ensureDir(join(rulesyncDir, "commands"));
      await ensureDir(join(rulesyncDir, "subagents"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      await writeFileContent(
        join(rulesyncDir, "commands/test-cmd.md"),
        `---
description: "Test command"
targets: ["*"]
---
Test command body`,
      );

      const result = await executeGenerate({
        targets: ["cursor"],
        features: ["rules", "commands"],
        simulateCommands: true,
        simulateSubagents: true,
        simulateSkills: true,
      });

      expect(result.success).toBe(true);
      expect(result.config?.simulateCommands).toBe(true);
      expect(result.config?.simulateSubagents).toBe(true);
      expect(result.config?.simulateSkills).toBe(true);
    });

    it("should format result as JSON string", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      // Import the tools to test JSON formatting
      const { generateTools } = await import("./generate.js");
      const jsonResult = await generateTools.executeGenerate.execute({
        targets: ["agentsmd"],
        features: ["rules"],
      });

      // Should be valid JSON
      const parsed: McpGenerateResult = JSON.parse(jsonResult);
      expect(parsed.success).toBe(true);
    });

    it("should handle modularMcp option", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      // Use rules feature instead of mcp since mcp requires mcp.json file
      const result = await executeGenerate({
        targets: ["claudecode"],
        features: ["rules"],
        modularMcp: true,
      });

      expect(result.success).toBe(true);
      expect(result.config?.modularMcp).toBe(true);
    });

    it("should handle delete option", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      await ensureDir(rulesyncDir);
      await ensureDir(join(rulesyncDir, "rules"));

      await writeFileContent(
        join(rulesyncDir, "rules/overview.md"),
        `---
root: true
targets: ["*"]
---
# Overview`,
      );

      const result = await executeGenerate({
        targets: ["agentsmd"],
        features: ["rules"],
        delete: true,
      });

      expect(result.success).toBe(true);
      expect(result.config?.delete).toBe(true);
    });
  });
});
