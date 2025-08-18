import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig, mockLogger } from "../../test-utils/index.js";
import type { MergedConfig } from "../../types/index.js";
import { loadConfig } from "../../utils/index.js";
import { configCommand } from "./config.js";

vi.mock("../../utils/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../utils/index.js")>("../../utils/index.js");
  return {
    ...actual,
    loadConfig: vi.fn(),
    generateSampleConfig: actual.generateSampleConfig,
  };
});
vi.mock("../../utils/logger.js", () => ({
  logger: mockLogger,
}));
vi.mock("node:fs");

const mockLoadConfig = vi.mocked(loadConfig);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("showConfig", () => {
    it("should display configuration when found", async () => {
      const mockConfig = createMockConfig();
      mockLoadConfig.mockResolvedValue({
        isEmpty: false,
        filepath: "/path/to/rulesync.jsonc",
        config: mockConfig,
      });

      await configCommand();

      expect(mockLoadConfig).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        "Configuration loaded from: /path/to/rulesync.jsonc\n",
      );
      expect(mockLogger.log).toHaveBeenCalledWith("\nAI Rules Directory: .rulesync");
      expect(mockLogger.log).toHaveBeenCalledWith(
        "\nDefault Targets: amazonqcli, augmentcode, copilot, cursor, cline, claudecode, codexcli, opencode, roo, geminicli, kiro, junie, windsurf",
      );
    });

    it("should display default configuration when no config found", async () => {
      const mockConfig = createMockConfig();
      mockLoadConfig.mockResolvedValue({
        isEmpty: true,
        config: mockConfig,
      });

      await configCommand();

      expect(mockLoadConfig).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        "No configuration file found. Using default configuration.\n",
      );
      expect(mockLogger.log).toHaveBeenCalledWith("Current configuration:");
    });

    it("should display excluded targets when present", async () => {
      const mockConfig: MergedConfig = {
        ...createMockConfig(),
        exclude: ["roo", "cline"],
      };
      mockLoadConfig.mockResolvedValue({
        isEmpty: false,
        filepath: "/path/to/rulesync.jsonc",
        config: mockConfig,
      });

      await configCommand();

      expect(mockLogger.log).toHaveBeenCalledWith("Excluded Targets: roo, cline");
    });

    it("should display base directories when present", async () => {
      const mockConfig: MergedConfig = {
        ...createMockConfig(),
        baseDir: ["./packages/frontend", "./packages/backend"],
      };
      mockLoadConfig.mockResolvedValue({
        isEmpty: false,
        filepath: "/path/to/rulesync.jsonc",
        config: mockConfig,
      });

      await configCommand();

      expect(mockLogger.log).toHaveBeenCalledWith(
        "\nBase Directories: ./packages/frontend, ./packages/backend",
      );
    });

    it("should display watch configuration when present", async () => {
      const mockConfig: MergedConfig = {
        ...createMockConfig(),
        watch: {
          enabled: true,
          interval: 2000,
          ignore: ["node_modules/**", "dist/**"],
        },
      };
      mockLoadConfig.mockResolvedValue({
        isEmpty: false,
        filepath: "/path/to/rulesync.jsonc",
        config: mockConfig,
      });

      await configCommand();

      expect(mockLogger.log).toHaveBeenCalledWith("\nWatch Configuration:");
      expect(mockLogger.log).toHaveBeenCalledWith("  Enabled: true");
      expect(mockLogger.log).toHaveBeenCalledWith("  Interval: 2000ms");
      expect(mockLogger.log).toHaveBeenCalledWith("  Ignore patterns: node_modules/**, dist/**");
    });

    it("should handle errors during config loading", async () => {
      mockLoadConfig.mockRejectedValue(new Error("Config loading failed"));

      // Don't test process.exit, just test that error is logged
      await configCommand().catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        "❌ Failed to load configuration:",
        "Config loading failed",
      );
    });
  });

  describe("initConfig", () => {
    it("should create JSONC config file by default", async () => {
      await configCommand({ init: true });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("rulesync.jsonc"),
        expect.stringContaining('"targets"'),
        "utf-8",
      );
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining("Created configuration file:"),
      );
    });

    it("should create config with custom targets", async () => {
      await configCommand({ init: true, targets: "claudecode,geminicli" });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('["claudecode","geminicli"]');
    });

    it("should create config with exclude option", async () => {
      await configCommand({ init: true, exclude: "roo,cline" });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('"exclude": ["roo","cline"]');
    });

    it("should create config with custom aiRulesDir", async () => {
      await configCommand({ init: true, aiRulesDir: ".custom-rules" });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('"aiRulesDir": ".custom-rules"');
    });

    it("should create config with baseDir", async () => {
      await configCommand({ init: true, baseDir: "./packages" });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('"baseDir": "./packages"');
    });

    it("should create config with verbose and delete options", async () => {
      await configCommand({ init: true, verbose: false, delete: true });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('"verbose": false');
      expect(content).toContain('"delete": true');
    });

    it("should create TypeScript config file when specified", async () => {
      await configCommand({ init: true, format: "ts" });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("rulesync.ts"),
        expect.stringContaining("import type { ConfigOptions }"),
        "utf-8",
      );
    });

    it("should fail with invalid format", async () => {
      const spy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(configCommand({ init: true, format: "invalid" as any })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        "❌ Invalid format: invalid. Valid formats are: jsonc, ts",
      );
      spy.mockRestore();
    });

    it("should fail with invalid targets", async () => {
      const spy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(configCommand({ init: true, targets: "invalid-target" })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockLogger.error).toHaveBeenCalledWith("❌ Invalid target: invalid-target");
      spy.mockRestore();
    });

    it("should fail with invalid exclude targets", async () => {
      const spy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(configCommand({ init: true, exclude: "invalid-exclude" })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockLogger.error).toHaveBeenCalledWith("❌ Invalid exclude target: invalid-exclude");
      spy.mockRestore();
    });

    it("should handle file write errors", async () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const spy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(configCommand({ init: true })).rejects.toThrow("process.exit called");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "❌ Failed to create configuration file: Permission denied",
      );
      spy.mockRestore();
    });

    it("should create TypeScript config with custom options", async () => {
      // Reset mock to clear previous error
      mockWriteFileSync.mockClear();
      mockWriteFileSync.mockImplementation(() => {});

      await configCommand({
        init: true,
        format: "ts",
        targets: "cursor,kiro",
        verbose: false,
      });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('["cursor","kiro"]');
      expect(content).toContain("verbose: false");
    });

    it("should create TypeScript config with all optional properties", async () => {
      // Reset mock to clear previous error
      mockWriteFileSync.mockClear();
      mockWriteFileSync.mockImplementation(() => {});

      await configCommand({
        init: true,
        format: "ts",
        targets: "claudecode",
        exclude: "copilot",
        aiRulesDir: ".rules",
        baseDir: "./projects",
        verbose: true,
        delete: true,
      });

      const content = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(content).toContain('targets: ["claudecode"]');
      expect(content).toContain('exclude: ["copilot"]');
      expect(content).toContain('aiRulesDir: ".rules"');
      expect(content).toContain('baseDir: "./projects"');
      expect(content).toContain("verbose: true");
      expect(content).toContain("delete: true");
    });
  });
});
