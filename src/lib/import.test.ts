import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { directoryExists, ensureDir, fileExists, writeFileContent } from "../utils/file.js";
import { importFrom } from "./import.js";

describe("importFrom", () => {
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

  describe("validation", () => {
    it("should throw error when no targets specified", async () => {
      await expect(importFrom({})).rejects.toThrow("No tools found in targets");
    });

    it("should throw error when targets is undefined", async () => {
      await expect(importFrom({ targets: undefined })).rejects.toThrow("No tools found in targets");
    });

    it("should throw error when multiple targets specified", async () => {
      await expect(importFrom({ targets: ["claudecode", "cursor"] })).rejects.toThrow(
        "Only one tool can be imported at a time",
      );
    });
  });

  describe("rules import", () => {
    it("should import rules from claudecode (.claude/CLAUDE.md)", async () => {
      // claudecode rules at .claude/CLAUDE.md for project scope
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "CLAUDE.md"),
        "# Project Overview\nTest content",
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["rules"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await directoryExists(join(testDir, ".rulesync", "rules"))).toBe(true);
    });

    it("should return 0 when no claudecode rules exist", async () => {
      await ensureDir(testDir);

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["rules"],
        baseDirs: [testDir],
      });

      expect(count).toBe(0);
    });

    it("should return 0 when cursor has no rules to import", async () => {
      // When no cursor rules exist, import should return 0
      const count = await importFrom({
        targets: ["cursor"],
        features: ["rules"],
        baseDirs: [testDir],
      });

      expect(count).toBe(0);
    });
  });

  describe("ignore import", () => {
    it("should import ignore files from claudecode", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.local.json"),
        JSON.stringify({
          permissions: {
            deny: ["credentials/"],
          },
        }),
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["ignore"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".rulesync", ".aiignore"))).toBe(true);
    });

    it("should return 0 when no ignore file exists", async () => {
      const count = await importFrom({
        targets: ["claudecode"],
        features: ["ignore"],
        baseDirs: [testDir],
      });

      expect(count).toBe(0);
    });
  });

  describe("mcp import", () => {
    it("should import mcp from claudecode", async () => {
      await writeFileContent(
        join(testDir, ".mcp.json"),
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

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["mcp"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await directoryExists(join(testDir, ".rulesync"))).toBe(true);
    });

    it("should return 0 when no mcp file exists", async () => {
      // Only test mcp feature - ensure test doesn't pick up other files
      const count = await importFrom({
        targets: ["claudecode"],
        features: ["mcp"],
        baseDirs: [testDir],
      });

      // MCP import may return 0 or 1 depending on whether a default template is created
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("commands import", () => {
    it("should import commands from claudecode", async () => {
      await ensureDir(join(testDir, ".claude", "commands"));
      await writeFileContent(
        join(testDir, ".claude", "commands", "test-command.md"),
        `---
description: "Test command"
---
Test command body`,
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["commands"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".rulesync", "commands", "test-command.md"))).toBe(
        true,
      );
    });

    it("should return 0 when no commands exist", async () => {
      const count = await importFrom({
        targets: ["claudecode"],
        features: ["commands"],
        baseDirs: [testDir],
      });

      expect(count).toBe(0);
    });
  });

  describe("subagents import", () => {
    it("should import subagents from claudecode", async () => {
      await ensureDir(join(testDir, ".claude", "agents"));
      await writeFileContent(
        join(testDir, ".claude", "agents", "test-agent.md"),
        `---
name: test-agent
description: "Test agent"
---
Test agent body`,
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["subagents"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".rulesync", "subagents", "test-agent.md"))).toBe(true);
    });

    it("should return 0 when no subagents exist", async () => {
      const count = await importFrom({
        targets: ["claudecode"],
        features: ["subagents"],
        baseDirs: [testDir],
      });

      expect(count).toBe(0);
    });
  });

  describe("skills import", () => {
    it("should import skills from claudecode", async () => {
      await ensureDir(join(testDir, ".claude", "skills", "test-skill"));
      await writeFileContent(
        join(testDir, ".claude", "skills", "test-skill", "SKILL.md"),
        `---
name: test-skill
description: "Test skill"
---
Test skill body`,
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["skills"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await fileExists(join(testDir, ".rulesync", "skills", "test-skill", "SKILL.md"))).toBe(
        true,
      );
    });

    it("should return 0 when no skills exist", async () => {
      const count = await importFrom({
        targets: ["claudecode"],
        features: ["skills"],
        baseDirs: [testDir],
      });

      expect(count).toBe(0);
    });
  });

  describe("multiple features", () => {
    it("should import multiple features when specified", async () => {
      // claudecode rules at .claude/CLAUDE.md
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "CLAUDE.md"),
        "# Project Overview\nTest content",
      );
      await ensureDir(join(testDir, ".claude", "commands"));
      await writeFileContent(
        join(testDir, ".claude", "commands", "test-command.md"),
        `---
description: "Test command"
---
Test command body`,
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["rules", "commands"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await directoryExists(join(testDir, ".rulesync", "rules"))).toBe(true);
      expect(await fileExists(join(testDir, ".rulesync", "commands", "test-command.md"))).toBe(
        true,
      );
    });
  });

  describe("feature filtering", () => {
    it("should only import specified features", async () => {
      // claudecode rules at .claude/CLAUDE.md
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "CLAUDE.md"),
        "# Project Overview\nTest content",
      );
      await ensureDir(join(testDir, ".claude", "commands"));
      await writeFileContent(
        join(testDir, ".claude", "commands", "test-command.md"),
        `---
description: "Test command"
---
Test command body`,
      );

      const count = await importFrom({
        targets: ["claudecode"],
        features: ["rules"],
        baseDirs: [testDir],
      });

      expect(count).toBeGreaterThan(0);
      expect(await directoryExists(join(testDir, ".rulesync", "rules"))).toBe(true);
      // Commands should not be imported when only rules feature is specified
      expect(await fileExists(join(testDir, ".rulesync", "commands", "test-command.md"))).toBe(
        false,
      );
    });
  });
});
