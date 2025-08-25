import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";

describe("AugmentcodeLegacyRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("build", () => {
    it("should create an instance with provided parameters", () => {
      const rule = AugmentcodeLegacyRule.build({
        filePath: ".augment-guidelines",
        fileContent: "# AugmentCode Legacy Guidelines\n\nTest content",
      });

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFilePath()).toBe(".augment-guidelines");
      expect(rule.getFileContent()).toBe("# AugmentCode Legacy Guidelines\n\nTest content");
    });
  });

  describe("fromFilePath", () => {
    it("should read file content from disk", async () => {
      const filePath = join(testDir, ".augment-guidelines");
      const expectedContent = "# Legacy Guidelines\n\n- Use TypeScript\n- Follow best practices";

      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(testDir, { recursive: true });
      await writeFile(filePath, expectedContent, "utf-8");

      const rule = await AugmentcodeLegacyRule.fromFilePath(filePath);

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(expectedContent);
    });
  });

  describe("writeFile", () => {
    it("should write file content to disk", async () => {
      const filePath = join(testDir, ".augment-guidelines");
      const content = "# AugmentCode Legacy\n\nContent for legacy format";

      const rule = AugmentcodeLegacyRule.build({
        filePath,
        fileContent: content,
      });

      await rule.writeFile();

      const writtenContent = await readFile(filePath, "utf-8");
      expect(writtenContent).toBe(content);
    });

    it("should create parent directories if they don't exist", async () => {
      const filePath = join(testDir, "nested", "deep", ".augment-guidelines");
      const content = "# Nested Guidelines";

      const rule = AugmentcodeLegacyRule.build({
        filePath,
        fileContent: content,
      });

      await rule.writeFile();

      const writtenContent = await readFile(filePath, "utf-8");
      expect(writtenContent).toBe(content);
    });
  });

  describe("validate", () => {
    it("should return success for valid rule", () => {
      const rule = AugmentcodeLegacyRule.build({
        filePath: ".augment-guidelines",
        fileContent: "# Valid content",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid file path", () => {
      const rule = AugmentcodeLegacyRule.build({
        filePath: "",
        fileContent: "# Content",
      });

      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain("File path must be a non-empty string");
    });

    it("should return error for wrong file name", () => {
      const rule = AugmentcodeLegacyRule.build({
        filePath: "wrong-name.md",
        fileContent: "# Content",
      });

      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain(
        "AugmentCode Legacy rule file must be named .augment-guidelines",
      );
    });

    it("should accept nested path ending with .augment-guidelines", () => {
      const rule = AugmentcodeLegacyRule.build({
        filePath: "project/.augment-guidelines",
        fileContent: "# Content",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule with plain markdown", () => {
      const augmentRule = AugmentcodeLegacyRule.build({
        filePath: ".augment-guidelines",
        fileContent: "# Legacy Guidelines\n\n- Use TypeScript\n- Test everything",
      });

      const rulesyncRule = augmentRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(".rulesync.md");
      expect(rulesyncRule.getFileContent()).toBe(
        "# Legacy Guidelines\n\n- Use TypeScript\n- Test everything",
      );
    });

    it("should handle nested paths correctly", () => {
      const augmentRule = AugmentcodeLegacyRule.build({
        filePath: "project/.augment-guidelines",
        fileContent: "# Content",
      });

      const rulesyncRule = augmentRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe("project/.rulesync.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AugmentcodeLegacyRule from RulesyncRule", async () => {
      const { RulesyncRule } = await import("../rulesync-rule.js");

      const rulesyncRule = RulesyncRule.build({
        filePath: ".rulesync.md",
        fileContent: "# Guidelines\n\n- Follow patterns\n- Write tests",
      });

      const augmentRule = AugmentcodeLegacyRule.fromRulesyncRule(rulesyncRule);

      expect(augmentRule.getFilePath()).toBe(".augment-guidelines");
      expect(augmentRule.getFileContent()).toBe("# Guidelines\n\n- Follow patterns\n- Write tests");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const rule = AugmentcodeLegacyRule.build({
        filePath: ".augment-guidelines",
        fileContent: "content",
      });

      expect(rule.getFilePath()).toBe(".augment-guidelines");
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const content = "# Test\n\nContent here";
      const rule = AugmentcodeLegacyRule.build({
        filePath: ".augment-guidelines",
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
