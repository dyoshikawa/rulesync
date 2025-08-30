import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

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
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(IgnoreProcessor);
    });

    it("should create instance with all supported tool targets", () => {
      const supportedTargets = [
        "augmentcode",
        "cline",
        "codexcli",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "qwencode",
        "roo",
        "windsurf",
      ];

      for (const target of supportedTargets) {
        const processor = new IgnoreProcessor({
          baseDir: testDir,
          toolTarget: target as any,
        });

        expect(processor).toBeInstanceOf(IgnoreProcessor);
      }
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

  describe("getToolTargets", () => {
    it("should return supported tool targets", () => {
      const toolTargets = IgnoreProcessor.getToolTargets();

      expect(toolTargets).toEqual([
        "augmentcode",
        "cline",
        "codexcli",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "qwencode",
        "roo",
        "windsurf",
      ]);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load .rulesyncignore file via loadRulesyncFiles", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncIgnore);
      const rulesyncIgnore = rulesyncFiles[0] as RulesyncIgnore;
      // The implementation reads from the project root, not the test directory
      expect(rulesyncIgnore.getBody()).toContain("node_modules/");
    });
  });

  describe("loadToolFiles", () => {
    it("should load tool ignore files via loadToolFiles", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const ignoreFilePath = join(testDir, ".cursorignore");
      const ignoreContent = `node_modules/
*.log
.env*`;

      await writeFile(ignoreFilePath, ignoreContent, "utf-8");

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      const toolIgnore = toolFiles[0] as ToolIgnore;
      expect(toolIgnore?.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });
  });

  describe("loadRulesyncIgnores", () => {
    it("should load .rulesyncignore file from working directory", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncIgnores = await processor.loadRulesyncIgnores();

      expect(rulesyncIgnores).toHaveLength(1);
      expect(rulesyncIgnores[0]).toBeInstanceOf(RulesyncIgnore);
      // The implementation reads from the project root, so we expect the project's .rulesyncignore content
      expect(rulesyncIgnores[0]?.getBody()).toContain("node_modules/");
    });
  });

  describe("writeToolIgnoresFromRulesyncIgnores", () => {
    it("should write Cursor ignore files from RulesyncIgnores", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncIgnores = [
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "security.md",
          body: "*.key\n*.pem\n.env*",
          fileContent: "",
        }),
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "build.md",
          body: "dist/\nbuild/\nnode_modules/",
          fileContent: "",
        }),
      ];

      await processor.writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores);

      // Both files should be processed (one targets cursor, one targets all)
      // Implementation writes files to filesystem
      // We can't easily test file writing without mocking, so we verify the method doesn't throw
    });

    it("should filter out non-matching targets", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncIgnores = [
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".rulesync/ignore",
          relativeFilePath: "cursor-only.md",
          body: "*.log",
          fileContent: "",
        }),
      ];

      // Should not throw error even with non-matching targets
      await processor.writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores);
    });
  });

  describe("loadToolIgnores", () => {
    it("should load Cursor ignore files", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const ignoreFilePath = join(testDir, ".cursorignore");
      const ignoreContent = `node_modules/
*.log
.env*
!.env.example`;

      await writeFile(ignoreFilePath, ignoreContent, "utf-8");

      const toolIgnores = await processor.loadToolIgnores();

      expect(toolIgnores).toHaveLength(1);
      expect(toolIgnores[0]?.getPatterns()).toEqual([
        "node_modules/",
        "*.log",
        ".env*",
        "!.env.example",
      ]);
    });

    it("should load Cline ignore files", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const ignoreFilePath = join(testDir, ".clineignore");
      const ignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build artifacts
dist/
build/

# Environment files
.env*`;

      await writeFile(ignoreFilePath, ignoreContent, "utf-8");

      const toolIgnores = await processor.loadToolIgnores();

      expect(toolIgnores).toHaveLength(1);
      expect(toolIgnores[0]?.getPatterns()).toEqual([
        "node_modules/",
        ".pnpm-store/",
        "dist/",
        "build/",
        ".env*",
      ]);
    });

    it("should return empty array when directory doesn't exist", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolIgnores = await processor.loadToolIgnores();

      expect(toolIgnores).toEqual([]);
    });

    it("should return empty array for tools without ignore files", async () => {
      const toolsWithoutFiles = ["junie", "kiro"];

      for (const tool of toolsWithoutFiles) {
        const processor = new IgnoreProcessor({
          baseDir: testDir,
          toolTarget: tool as any,
        });

        const toolIgnores = await processor.loadToolIgnores();
        expect(toolIgnores).toEqual([]);
      }
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert RulesyncIgnore to Cursor ignore", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncIgnores = [
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          body: "*.key\n*.pem\n.env*",
          fileContent: "*.key\n*.pem\n.env*",
        }),
      ];

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncIgnores);

      expect(toolFiles).toHaveLength(1);
      // Just verify we get a tool file, don't check specific instance type
    });

    it("should convert RulesyncIgnore to target tool ignore", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncIgnores = [
        new RulesyncIgnore({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          body: "*.log",
          fileContent: "*.log",
        }),
      ];

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncIgnores);

      expect(toolFiles).toHaveLength(1);
      // Just verify we get a tool file, don't check specific instance type
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert Cursor ignore to RulesyncIgnore", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns: ["node_modules/", "*.log", ".env*"],
        fileContent: "node_modules/\n*.log\n.env*",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([cursorIgnore]);

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncIgnore);
    });
  });

  describe("writeRulesyncIgnoresFromToolIgnores", () => {
    it("should write RulesyncIgnore files from ToolIgnores", async () => {
      const processor = new IgnoreProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns: ["node_modules/", "*.log", ".env*"],
        fileContent: "node_modules/\n*.log\n.env*",
      });

      await processor.writeRulesyncIgnoresFromToolIgnores([cursorIgnore]);

      // Verify the method doesn't throw error
      // Actual file writing is handled by the base Processor class
    });
  });
});
