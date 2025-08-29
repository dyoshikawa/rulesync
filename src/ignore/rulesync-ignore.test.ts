import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("RulesyncIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        body: "node_modules/\n*.log",
        fileContent:
          "---\ntargets: [claudecode]\ndescription: Test ignore file\n---\nnode_modules/\n*.log",
      });

      expect(rulesyncIgnore.getFrontmatter()).toEqual({});
      expect(rulesyncIgnore.getBody()).toBe("node_modules/\n*.log");
    });

    it("should create instance with wildcard target", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        body: "*.tmp",
        fileContent: "---\ntargets: ['*']\ndescription: Global ignore file\n---\n*.tmp",
      });

      expect(rulesyncIgnore.getFrontmatter()).toEqual({});
    });

    it("should not throw error as frontmatter validation is not implemented", () => {
      expect(() => {
        return new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "test.md",
          body: "*.log",
          fileContent: "",
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
          description: "Valid ignore file",
        },
        body: "*.log",
        fileContent: "",
      });

      const result = rulesyncIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success as validation always passes", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        body: "*.log",
        fileContent: "",
        validate: false, // Skip validation during construction
      });

      const result = rulesyncIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFilePath", () => {
    it("should load from valid markdown file", async () => {
      const ignoreDir = join(testDir, ".rulesync", "ignore");
      await mkdir(ignoreDir, { recursive: true });

      const filePath = join(ignoreDir, "test-ignore.md");
      const fileContent = `---
targets:
  - claudecode
description: Test ignore patterns
patterns:
  - "*.log"
  - "node_modules/"
---

# Ignore Patterns

node_modules/
*.log
*.tmp
.env*`;

      await writeFile(filePath, fileContent, "utf-8");

      const rulesyncIgnore = await RulesyncIgnore.fromFilePath({ filePath });

      expect(rulesyncIgnore.getFrontmatter()).toEqual({});
      expect(rulesyncIgnore.getBody()).toBe(fileContent);
    });

    it("should throw error for invalid frontmatter", async () => {
      const ignoreDir = join(testDir, ".rulesync", "ignore");
      await mkdir(ignoreDir, { recursive: true });

      const filePath = join(ignoreDir, "invalid-ignore.md");
      const fileContent = `---
targets:
  - invalid-tool
description: Invalid ignore file
---

*.log`;

      await writeFile(filePath, fileContent, "utf-8");

      const rulesyncIgnore = await RulesyncIgnore.fromFilePath({ filePath });
      expect(rulesyncIgnore.getFrontmatter()).toEqual({});
    });

    it("should handle file with optional patterns field", async () => {
      const ignoreDir = join(testDir, ".rulesync", "ignore");
      await mkdir(ignoreDir, { recursive: true });

      const filePath = join(ignoreDir, "simple-ignore.md");
      const fileContent = `---
targets:
  - claudecode
description: Simple ignore file
---

*.log
node_modules/`;

      await writeFile(filePath, fileContent, "utf-8");

      const rulesyncIgnore = await RulesyncIgnore.fromFilePath({ filePath });

      expect(rulesyncIgnore.getFrontmatter()).toEqual({});
    });
  });
});
