import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
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
vi.mock("node:fs");

const mockLoadConfig = vi.mocked(loadConfig);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      expect(console.log).toHaveBeenCalledWith(
        "Configuration loaded from: /path/to/rulesync.jsonc\n",
      );
      expect(console.log).toHaveBeenCalledWith("\nAI Rules Directory: .rulesync");
      expect(console.log).toHaveBeenCalledWith(
        "\nDefault Targets: augmentcode, copilot, cursor, cline, claudecode, roo, geminicli, kiro",
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
      expect(console.log).toHaveBeenCalledWith(
        "No configuration file found. Using default configuration.\n",
      );
      expect(console.log).toHaveBeenCalledWith("Current configuration:");
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

      expect(console.log).toHaveBeenCalledWith("Excluded Targets: roo, cline");
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

      expect(console.log).toHaveBeenCalledWith(
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

      expect(console.log).toHaveBeenCalledWith("\nWatch Configuration:");
      expect(console.log).toHaveBeenCalledWith("  Enabled: true");
      expect(console.log).toHaveBeenCalledWith("  Interval: 2000ms");
      expect(console.log).toHaveBeenCalledWith("  Ignore patterns: node_modules/**, dist/**");
    });

    it("should handle errors during config loading", async () => {
      mockLoadConfig.mockRejectedValue(new Error("Config loading failed"));

      // Don't test process.exit, just test that error is logged
      await configCommand().catch(() => {});

      expect(console.error).toHaveBeenCalledWith(
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
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("✅ Created configuration file:"),
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

    it("should create TypeScript config with custom options", async () => {
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

    it("should error for invalid format", async () => {
      await configCommand({ init: true, format: "invalid" as any }).catch(() => {});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("❌ Invalid format: invalid. Valid formats are:"),
      );
    });

    it("should handle write errors", async () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error("Write failed");
      });

      await configCommand({ init: true }).catch(() => {});

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("❌ Failed to create configuration file: Write failed"),
      );
    });
  });
});
