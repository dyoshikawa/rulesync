import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { ConfigFileLoader } from "./config-file-loader.js";

describe("ConfigFileLoader", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let loader: ConfigFileLoader;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    loader = new ConfigFileLoader();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("load", () => {
    it("should load configuration successfully", async () => {
      const configPath = join(testDir, "rulesync.jsonc");
      const config = {
        rules: {
          files: ["test.md"],
        },
      };
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const result = await loader.load({ configPath });

      expect(result.isEmpty).toBe(false);
      expect(result.config).toMatchObject(config);
    });

    it("should handle configuration loading errors", async () => {
      const nonExistentPath = join(testDir, "nonexistent.json");

      // When config file doesn't exist, it returns default config with isEmpty flag
      const result = await loader.load({ configPath: nonExistentPath });
      expect(result.isEmpty).toBe(false); // c12 returns defaults, not empty
      expect(result.config).toBeDefined();
    });

    it("should load with default options", async () => {
      const result = await loader.load();

      expect(result).toBeDefined();
    });

    it.skip("should handle non-Error exceptions", async () => {
      const mockLoadConfig = vi.fn().mockRejectedValue("string error");
      vi.doMock("../../utils/config-loader.js", () => ({
        loadConfig: mockLoadConfig,
      }));

      const { ConfigFileLoader: MockedConfigFileLoader } = await import("./config-file-loader.js");
      const mockedLoader = new MockedConfigFileLoader();

      await expect(mockedLoader.load()).rejects.toThrow(
        "Failed to load configuration file: string error",
      );

      vi.doUnmock("../../utils/config-loader.js");
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const filePath = join(testDir, "existing.json");
      await writeFile(filePath, "{}");

      const exists = await loader.exists(filePath);

      expect(exists).toBe(true);
    });

    it("should return false for non-existing file", async () => {
      const filePath = join(testDir, "nonexistent.json");

      const exists = await loader.exists(filePath);

      expect(exists).toBe(false);
    });

    it("should handle access errors gracefully", async () => {
      const invalidPath = "/invalid/path/that/cannot/exist";

      const exists = await loader.exists(invalidPath);

      expect(exists).toBe(false);
    });
  });

  describe("resolvePath", () => {
    it("should return undefined for undefined configPath", () => {
      const result = loader.resolvePath(undefined);

      expect(result).toBeUndefined();
    });

    it("should return absolute path as-is", () => {
      const absolutePath = "/absolute/path/config.json";

      const result = loader.resolvePath(absolutePath);

      expect(result).toBe(absolutePath);
    });

    it("should resolve relative path with working directory", () => {
      const relativePath = "config.json";
      const workingDir = testDir;

      const result = loader.resolvePath(relativePath, workingDir);

      expect(result).toBe(join(workingDir, relativePath));
    });

    it("should resolve relative path with current working directory when workingDirectory is not provided", () => {
      const relativePath = "config.json";

      const result = loader.resolvePath(relativePath);

      expect(result).toBe(join(process.cwd(), relativePath));
    });

    it("should handle empty string configPath", () => {
      const result = loader.resolvePath("");

      // Empty string is treated as falsy, so returns undefined
      expect(result).toBeUndefined();
    });

    it("should resolve nested relative paths", () => {
      const relativePath = "nested/config/file.json";
      const workingDir = testDir;

      const result = loader.resolvePath(relativePath, workingDir);

      expect(result).toBe(join(workingDir, relativePath));
    });
  });
});
