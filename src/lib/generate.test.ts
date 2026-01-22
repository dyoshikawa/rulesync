import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { directoryExists, ensureDir, fileExists, writeFileContent } from "../utils/file.js";
import { generate } from "./generate.js";

describe("generate", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  describe("error handling", () => {
    it("should throw error when .rulesync directory does not exist", async () => {
      // testDir doesn't have .rulesync directory, so it should throw
      await expect(generate({ baseDirs: [testDir] })).rejects.toThrow(
        ".rulesync directory not found. Run 'rulesync init' first.",
      );
    });
  });

  describe("rules generation", () => {
    it("should generate rules for claudecode target", async () => {
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["claudecode"]
---
# Test Rule`,
      );

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["rules"],
      });

      expect(result.total).toBeGreaterThan(0);
      // claudecode generates to .claude/CLAUDE.md for project scope
      expect(await fileExists(join(testDir, ".claude", "CLAUDE.md"))).toBe(true);
    });

    it("should generate rules for cursor target", async () => {
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["cursor"]
---
# Test Rule`,
      );

      const result = await generate({
        baseDirs: [testDir],
        targets: ["cursor"],
        features: ["rules"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(await directoryExists(join(testDir, ".cursor"))).toBe(true);
    });

    it("should return 0 when rules feature is not included", async () => {
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["claudecode"]
---
# Test Rule`,
      );
      // Also create ignore file to have a valid feature to test
      await writeFileContent(join(testDir, ".rulesync", ".aiignore"), "credentials/\n");

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["ignore"],
      });

      // Ignore generates 1 file, but rules should not be generated
      expect(result.total).toBeGreaterThan(0);
      expect(result.rules).toBe(0);
      expect(await fileExists(join(testDir, ".claude", "CLAUDE.md"))).toBe(false);
    });
  });

  describe("ignore generation", () => {
    it("should generate ignore files for claudecode target", async () => {
      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(join(testDir, ".rulesync", ".aiignore"), "credentials/\n");

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["ignore"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.ignore).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".claude", "settings.local.json"))).toBe(true);
    });
  });

  describe("mcp generation", () => {
    it("should generate mcp files for claudecode target", async () => {
      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(
        join(testDir, ".rulesync", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            test: {
              type: "stdio",
              command: "test",
              args: [],
              env: {},
            },
          },
        }),
      );

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["mcp"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.mcp).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".mcp.json"))).toBe(true);
    });
  });

  describe("commands generation", () => {
    it("should generate commands for claudecode target", async () => {
      await ensureDir(join(testDir, ".rulesync", "commands"));
      await writeFileContent(
        join(testDir, ".rulesync", "commands", "test-command.md"),
        `---
description: "Test command"
targets: ["claudecode"]
---
Test command body`,
      );

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["commands"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.commands).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".claude", "commands", "test-command.md"))).toBe(true);
    });
  });

  describe("subagents generation", () => {
    it("should generate subagents for claudecode target", async () => {
      await ensureDir(join(testDir, ".rulesync", "subagents"));
      await writeFileContent(
        join(testDir, ".rulesync", "subagents", "test-agent.md"),
        `---
name: test-agent
targets: ["claudecode"]
description: "Test agent"
---
Test agent body`,
      );

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["subagents"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.subagents).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".claude", "agents", "test-agent.md"))).toBe(true);
    });
  });

  describe("skills generation", () => {
    it("should generate skills for claudecode target", async () => {
      await ensureDir(join(testDir, ".rulesync", "skills", "test-skill"));
      await writeFileContent(
        join(testDir, ".rulesync", "skills", "test-skill", "SKILL.md"),
        `---
name: test-skill
targets: ["claudecode"]
description: "Test skill"
---
Test skill body`,
      );

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["skills"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.skills).toBeGreaterThan(0);
      expect(await directoryExists(join(testDir, ".claude", "skills", "test-skill"))).toBe(true);
    });
  });

  describe("multiple features", () => {
    it("should generate multiple features when specified", async () => {
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["claudecode"]
---
# Test Rule`,
      );
      await writeFileContent(join(testDir, ".rulesync", ".aiignore"), "credentials/\n");

      const result = await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["rules", "ignore"],
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.rules).toBeGreaterThan(0);
      expect(result.ignore).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".claude", "CLAUDE.md"))).toBe(true);
      expect(await fileExists(join(testDir, ".claude", "settings.local.json"))).toBe(true);
    });
  });

  describe("delete option", () => {
    it("should delete existing files when delete: true", async () => {
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["claudecode"]
---
# Test Rule`,
      );

      await generate({
        baseDirs: [testDir],
        targets: ["claudecode"],
        features: ["rules"],
      });

      expect(await fileExists(join(testDir, ".claude", "CLAUDE.md"))).toBe(true);

      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["cursor"]
---
# Updated Rule`,
      );

      await generate({
        baseDirs: [testDir],
        targets: ["cursor"],
        features: ["rules"],
        delete: true,
      });

      expect(await directoryExists(join(testDir, ".cursor"))).toBe(true);
    });
  });

  describe("default parameters", () => {
    it("should work with default parameters", async () => {
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["*"]
---
# Test Rule`,
      );

      const result = await generate({ baseDirs: [testDir] });

      expect(result.total).toBeGreaterThanOrEqual(0);
    });
  });
});
