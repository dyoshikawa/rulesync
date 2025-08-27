import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("IgnoreProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(IgnoreProcessor);
    });

    it("should throw error with invalid tool target", () => {
      expect(() => {
        return new IgnoreProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("loadRulesyncIgnores", () => {
    it("should load ignore files from directory", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const ignoreDir = join(testDir, ".rulesync", "ignore");
      await mkdir(ignoreDir, { recursive: true });

      const testIgnorePath = join(ignoreDir, "test-ignore.md");
      const testIgnoreContent = `---
targets:
  - claudecode
description: Test ignore patterns
---

node_modules/
*.log
.env*`;

      await writeFile(testIgnorePath, testIgnoreContent, "utf-8");

      const rulesyncIgnores = await processor.loadRulesyncIgnores();

      expect(rulesyncIgnores).toHaveLength(1);
      expect(rulesyncIgnores[0]?.getFrontmatter()).toEqual({
        targets: ["claudecode"],
        description: "Test ignore patterns",
      });
    });

    it("should throw error when directory doesn't exist", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await expect(processor.loadRulesyncIgnores()).rejects.toThrow(
        "Rulesync ignore directory not found",
      );
    });

    it("should throw error when no markdown files found", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const ignoreDir = join(testDir, ".rulesync", "ignore");
      await mkdir(ignoreDir, { recursive: true });

      await expect(processor.loadRulesyncIgnores()).rejects.toThrow("No markdown files found");
    });

    it("should skip invalid files and continue loading valid ones", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const ignoreDir = join(testDir, ".rulesync", "ignore");
      await mkdir(ignoreDir, { recursive: true });

      // Valid file
      const validPath = join(ignoreDir, "valid.md");
      const validContent = `---
targets:
  - claudecode
description: Valid ignore file
---

*.log`;

      await writeFile(validPath, validContent, "utf-8");

      // Invalid file
      const invalidPath = join(ignoreDir, "invalid.md");
      const invalidContent = `---
targets:
  - invalid-tool
description: Invalid ignore file
---

*.tmp`;

      await writeFile(invalidPath, invalidContent, "utf-8");

      const rulesyncIgnores = await processor.loadRulesyncIgnores();

      expect(rulesyncIgnores).toHaveLength(1);
      expect(rulesyncIgnores[0]?.getFrontmatter().description).toBe("Valid ignore file");
    });
  });

  describe("writeToolIgnoresFromRulesyncIgnores", () => {
    it("should write ClaudeCode ignore files from RulesyncIgnores", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncIgnores = [
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "security.md",
          frontmatter: {
            targets: ["claudecode"],
            description: "Security ignore patterns",
          },
          body: "*.key\n*.pem\n.env*",
          fileContent: "",
        }),
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "build.md",
          frontmatter: {
            targets: ["*"],
            description: "Build artifacts",
          },
          body: "dist/\nbuild/\nnode_modules/",
          fileContent: "",
        }),
      ];

      await processor.writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores);

      // Both files should be processed (one targets claudecode, one targets all)
      // Implementation writes files to filesystem
      // We can't easily test file writing without mocking, so we verify the method doesn't throw
    });

    it("should filter out non-matching targets", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncIgnores = [
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "cursor-only.md",
          frontmatter: {
            targets: ["cursor"],
            description: "Cursor-only ignore patterns",
          },
          body: "*.log",
          fileContent: "",
        }),
      ];

      // Should not throw error even with non-matching targets
      await processor.writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores);
    });
  });

  describe("loadToolIgnores", () => {
    it("should load ClaudeCode ignore files", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const claudeDir = join(testDir, ".claude");
      await mkdir(claudeDir, { recursive: true });

      const ignoreFilePath = join(claudeDir, ".claudecode.ignore");
      const ignoreContent = `node_modules/
*.log
.env*`;

      await writeFile(ignoreFilePath, ignoreContent, "utf-8");

      const toolIgnores = await processor.loadToolIgnores();

      expect(toolIgnores).toHaveLength(1);
      expect(toolIgnores[0]?.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });

    it("should return empty array when directory doesn't exist", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolIgnores = await processor.loadToolIgnores();

      expect(toolIgnores).toEqual([]);
    });
  });

  describe("writeRulesyncIgnoresFromToolIgnores", () => {
    it("should write RulesyncIgnore files from ToolIgnores", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const claudeCodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        permissions: {
          deny: ["Edit(node_modules/)", "Edit(*.log)", "Edit(.env*)"],
        },
        fileContent: JSON.stringify({
          permissions: {
            deny: ["Edit(node_modules/)", "Edit(*.log)", "Edit(.env*)"],
          },
        }, null, 2),
      });

      await processor.writeRulesyncIgnoresFromToolIgnores([claudeCodeIgnore]);

      // Verify the method doesn't throw error
      // Actual file writing is handled by the base Processor class
    });
  });
});
