import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/index.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { generate, getStatus, importConfig, initialize, validate } from "./core.js";

describe("API Core Functions", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("initialize", () => {
    it("should initialize a new rulesync project", async () => {
      const result = await initialize({
        baseDir: testDir,
      });

      // Should create at least overview file
      expect(result.createdFiles.length).toBeGreaterThanOrEqual(1);
      expect(result.createdFiles.some((f) => f.includes("overview.md"))).toBe(true);
      expect(result.baseDir).toBe(testDir);
      expect(result.config).toBeDefined();
      expect(result.config.aiRulesDir).toBe(".rulesync");

      // Check that .rulesync directory was created
      expect(existsSync(join(testDir, ".rulesync"))).toBe(true);
      expect(existsSync(join(testDir, ".rulesync", "rules"))).toBe(true);
      expect(existsSync(join(testDir, ".rulesync", "rules", "overview.md"))).toBe(true);
    });

    it("should handle legacy option", async () => {
      const result = await initialize({
        baseDir: testDir,
        legacy: true,
      });

      // Should create at least overview file
      expect(result.createdFiles.length).toBeGreaterThanOrEqual(1);
      expect(result.createdFiles.some((f) => f.includes("overview.md"))).toBe(true);

      // In legacy mode, files should be directly in .rulesync/
      expect(existsSync(join(testDir, ".rulesync", "overview.md"))).toBe(true);
    });

    it("should merge custom config options", async () => {
      const result = await initialize({
        baseDir: testDir,
        config: {
          legacy: true,
        },
      });

      expect(result.config.legacy).toBe(true);
    });
  });

  describe("generate", () => {
    beforeEach(async () => {
      // Initialize project first
      await initialize({ baseDir: testDir });
    });

    it("should generate files for specified tools", async () => {
      const result = await generate({
        baseDirs: [testDir],
        tools: ["cursor", "claudecode"],
      });

      expect(result.summary.totalFiles).toBeGreaterThan(0);
      expect(result.generatedFiles).toHaveLength(result.summary.totalFiles);

      // Check that files were actually generated
      expect(existsSync(join(testDir, ".cursorrules"))).toBe(true);
      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true);
    });

    it("should generate for all tools when all option is used", async () => {
      const result = await generate({
        baseDirs: [testDir],
        all: true,
      });

      expect(result.summary.totalFiles).toBeGreaterThan(2);
      expect(result.summary.successCount).toBeGreaterThan(0);
    });

    it("should handle generation errors gracefully", async () => {
      // Try to generate in a non-existent directory
      const result = await generate({
        baseDirs: [join(testDir, "non-existent")],
        tools: ["cursor"],
      });

      // Should not throw, but may have errors in results
      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
    });
  });

  describe("validate", () => {
    beforeEach(async () => {
      await initialize({ baseDir: testDir });
    });

    it("should validate a valid project", async () => {
      const result = await validate({
        baseDir: testDir,
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validatedFiles.length).toBeGreaterThan(0);
    });

    it("should detect validation errors", async () => {
      // Create an invalid config file
      await writeFileContent(join(testDir, "rulesync.jsonc"), "{ invalid json");

      const result = await validate({
        baseDir: testDir,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("getStatus", () => {
    it("should return uninitialized status for empty directory", async () => {
      const result = await getStatus({
        baseDir: testDir,
      });

      expect(result.isInitialized).toBe(false);
      expect(result.configStatus.exists).toBe(false);
      expect(result.rulesStatus.totalFiles).toBe(0);
    });

    it("should return initialized status after initialization", async () => {
      await initialize({ baseDir: testDir });

      const result = await getStatus({
        baseDir: testDir,
      });

      expect(result.isInitialized).toBe(true);
      expect(result.rulesStatus.totalFiles).toBeGreaterThan(0);
      expect(result.rulesStatus.usesLegacyFormat).toBe(false);
    });

    it("should detect generated files", async () => {
      await initialize({ baseDir: testDir });
      await generate({
        baseDirs: [testDir],
        tools: ["cursor", "claudecode"],
      });

      const result = await getStatus({
        baseDir: testDir,
      });

      expect(result.generatedFilesStatus.length).toBeGreaterThan(0);

      const cursorStatus = result.generatedFilesStatus.find((s) => s.tool === "cursor");
      expect(cursorStatus).toBeDefined();
      expect(cursorStatus?.files.some((f) => f.exists)).toBe(true);
    });
  });

  describe("importConfig", () => {
    beforeEach(async () => {
      await initialize({ baseDir: testDir });
    });

    it("should import existing configurations", async () => {
      // Create existing cursor config
      await writeFileContent(
        join(testDir, ".cursorrules"),
        "You are an expert TypeScript developer.\n\nUse functional programming patterns.",
      );

      const result = await importConfig({
        baseDir: testDir,
        sources: ["cursor"],
      });

      expect(result.summary.totalSources).toBe(1);
      expect(result.importedFiles).toHaveLength(1);
      expect(result.importedFiles[0]?.tool).toBe("cursor");
      expect(result.importedFiles[0]?.status).toBe("success");
      expect(result.createdFiles.length).toBeGreaterThan(0);
    });

    it("should handle missing source files", async () => {
      const result = await importConfig({
        baseDir: testDir,
        sources: ["cursor", "copilot"],
      });

      expect(result.summary.totalSources).toBe(2);
      expect(result.importedFiles.every((f) => f.status === "skipped")).toBe(true);
    });

    it("should create multiple rulesync files from multiple sources", async () => {
      // Create multiple source configs
      await writeFileContent(join(testDir, ".cursorrules"), "Cursor rules content");

      await ensureDir(join(testDir, ".github"));
      await writeFileContent(
        join(testDir, ".github", "copilot-instructions.md"),
        "# Copilot Instructions\nUse TypeScript",
      );

      const result = await importConfig({
        baseDir: testDir,
        sources: ["cursor", "copilot"],
      });

      expect(result.summary.successCount).toBe(2);
      expect(result.createdFiles.length).toBeGreaterThan(0);
    });
  });
});
