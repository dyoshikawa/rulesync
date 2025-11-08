import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { ConfigResolver } from "./config-resolver.js";

describe("config-resolver", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    // Convert relative testDir to absolute path for mocking process.cwd()
    const absoluteTestDir = resolve(testDir);
    vi.spyOn(process, "cwd").mockReturnValue(absoluteTestDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("global configuration", () => {
    it("should load global: true from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(true);
    });

    it("should load global: false from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should default global to false when not specified", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should allow CLI flag to override config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        global: true,
      });

      expect(config.getGlobal()).toBe(true);
    });
  });

  describe("backward compatibility with experimental options", () => {
    it("should support experimentalGlobal for backward compatibility", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalGlobal: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(true);
      expect(config.getExperimentalGlobal()).toBe(true);
    });

    it("should prioritize global over experimentalGlobal in config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: true,
        experimentalGlobal: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(true);
    });

    it("should prioritize global CLI flag over experimentalGlobal CLI flag", async () => {
      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        global: false,
        experimentalGlobal: true,
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should prioritize global CLI flag over experimentalGlobal in config", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalGlobal: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        global: false,
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should support experimentalSimulateCommands for backward compatibility", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalSimulateCommands: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSimulatedCommands()).toBe(true);
      expect(config.getExperimentalSimulateCommands()).toBe(true);
    });

    it("should prioritize simulatedCommands over experimentalSimulateCommands", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        simulatedCommands: false,
        experimentalSimulateCommands: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSimulatedCommands()).toBe(false);
    });

    it("should support experimentalSimulateSubagents for backward compatibility", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        experimentalSimulateSubagents: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSimulatedSubagents()).toBe(true);
      expect(config.getExperimentalSimulateSubagents()).toBe(true);
    });

    it("should prioritize simulatedSubagents over experimentalSimulateSubagents", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        simulatedSubagents: false,
        experimentalSimulateSubagents: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSimulatedSubagents()).toBe(false);
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
      expect(config.getBaseDirs()).toContain("src");
      expect(config.getBaseDirs()).toContain("packages");
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
      expect(config.getBaseDirs()).toHaveLength(3);
      expect(config.getBaseDirs()).toContain("app1");
      expect(config.getBaseDirs()).toContain("app2");
      expect(config.getBaseDirs()).toContain("app3");
    });
  });
});
