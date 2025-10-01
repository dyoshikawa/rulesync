import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { ConfigResolver } from "./config-resolver.js";

describe("config-resolver", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("experimentalGlobal configuration", () => {
    it("should load experimentalGlobal: true from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalGlobal: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.experimentalGlobal).toBe(true);
    });

    it("should load experimentalGlobal: false from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalGlobal: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.experimentalGlobal).toBe(false);
    });

    it("should default experimentalGlobal to false when not specified", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.experimentalGlobal).toBe(false);
    });

    it("should allow CLI flag to override config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalGlobal: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        experimentalGlobal: true,
      });

      expect(config.experimentalGlobal).toBe(true);
    });

    it("should use getExperimentalGlobal() method", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalGlobal: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getExperimentalGlobal()).toBe(true);
    });
  });

  describe("base directory resolution", () => {
    it("should load configured baseDirs from file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./src", "./packages"],
        experimentalGlobal: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      // baseDirs might be normalized (`./ ` prefix removed)
      expect(config.baseDirs).toContain("src");
      expect(config.baseDirs).toContain("packages");
    });

    it("should handle multiple baseDirs", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./app1", "./app2", "./app3"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      // baseDirs might be normalized (`./ ` prefix removed)
      expect(config.baseDirs).toHaveLength(3);
      expect(config.baseDirs).toContain("app1");
      expect(config.baseDirs).toContain("app2");
      expect(config.baseDirs).toContain("app3");
    });
  });
});
