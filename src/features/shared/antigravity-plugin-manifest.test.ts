import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { ensureAntigravityPluginManifests } from "./antigravity-plugin-manifest.js";

describe("ensureAntigravityPluginManifests", () => {
  it("writes a manifest named after the plugin directory when none exists", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const pluginRoot = join(testDir, "review-tools");
      await ensureDir(pluginRoot);

      const result = await ensureAntigravityPluginManifests({
        outputRoots: [pluginRoot],
        dryRun: false,
        logger: createMockLogger(),
      });

      expect(result).toEqual({
        count: 1,
        paths: ["plugin.json"],
        hasDiff: true,
        sourceLoadFailed: false,
      });
      expect(await readFileContent(join(pluginRoot, "plugin.json"))).toBe(
        '{\n  "name": "review-tools"\n}\n',
      );
    } finally {
      await cleanup();
    }
  });

  it("leaves an existing manifest untouched", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const pluginRoot = join(testDir, "review-tools");
      const existing = '{ "name": "custom", "description": "Hand-authored" }';
      await writeFileContent(join(pluginRoot, "plugin.json"), existing);

      const result = await ensureAntigravityPluginManifests({
        outputRoots: [pluginRoot],
        dryRun: false,
        logger: createMockLogger(),
      });

      expect(result).toEqual({ count: 0, paths: [], hasDiff: false, sourceLoadFailed: false });
      expect(await readFileContent(join(pluginRoot, "plugin.json"))).toBe(existing);
    } finally {
      await cleanup();
    }
  });

  it("reports the missing manifest without writing it in preview mode", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const pluginRoot = join(testDir, "review-tools");
      await ensureDir(pluginRoot);

      const result = await ensureAntigravityPluginManifests({
        outputRoots: [pluginRoot],
        dryRun: true,
        logger: createMockLogger(),
      });

      expect(result.hasDiff).toBe(true);
      expect(result.paths).toEqual(["plugin.json"]);
      expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("reports only the manifests it creates across several output roots", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const existingRoot = join(testDir, "existing");
      const missingRoot = join(testDir, "missing");
      const invalidRoot = join(testDir, "bad name");
      await writeFileContent(join(existingRoot, "plugin.json"), '{ "name": "existing" }');
      await ensureDir(missingRoot);
      await ensureDir(invalidRoot);
      const logger = createMockLogger();

      const result = await ensureAntigravityPluginManifests({
        outputRoots: [existingRoot, missingRoot, invalidRoot],
        dryRun: false,
        logger,
      });

      expect(result).toEqual({
        count: 1,
        paths: ["plugin.json"],
        hasDiff: true,
        sourceLoadFailed: false,
      });
      expect(await fileExists(join(missingRoot, "plugin.json"))).toBe(true);
      expect(await fileExists(join(invalidRoot, "plugin.json"))).toBe(false);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("warns and writes nothing when the directory name is not a valid plugin name", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const pluginRoot = join(testDir, "review tools");
      await ensureDir(pluginRoot);
      const logger = createMockLogger();

      const result = await ensureAntigravityPluginManifests({
        outputRoots: [pluginRoot],
        dryRun: false,
        logger,
      });

      expect(result).toEqual({ count: 0, paths: [], hasDiff: false, sourceLoadFailed: false });
      expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Cannot derive an Antigravity plugin name"),
      );
    } finally {
      await cleanup();
    }
  });
});
