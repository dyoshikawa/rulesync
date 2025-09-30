import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import type { ConfigCommandOptions } from "./config.js";
import { configCommand } from "./config.js";

// Mock dependencies
vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");

describe("configCommand", () => {
  let mockExit: any;

  beforeEach(() => {
    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("Process exit");
    }) as any);

    // Setup logger mocks
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup file utility mocks
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("without init option", () => {
    it("should show help message when no init option is provided", async () => {
      const options: ConfigCommandOptions = {};

      await configCommand(options);

      expect(logger.info).toHaveBeenCalledWith(
        "Please run `rulesync config init` to create a new configuration file",
      );
      expect(fileExists).not.toHaveBeenCalled();
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should show help message when init option is false", async () => {
      const options: ConfigCommandOptions = { init: false };

      await configCommand(options);

      expect(logger.info).toHaveBeenCalledWith(
        "Please run `rulesync config init` to create a new configuration file",
      );
      expect(fileExists).not.toHaveBeenCalled();
      expect(writeFileContent).not.toHaveBeenCalled();
    });
  });

  describe("with init option", () => {
    it("should create configuration file when init option is true", async () => {
      const options: ConfigCommandOptions = { init: true };

      await configCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Initializing configuration...");
      expect(fileExists).toHaveBeenCalledWith("rulesync.jsonc");
      expect(writeFileContent).toHaveBeenCalledWith("rulesync.jsonc", expect.any(String));
      expect(logger.success).toHaveBeenCalledWith("Configuration file created successfully!");
    });

    it("should exit when configuration file already exists", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      const options: ConfigCommandOptions = { init: true };

      await expect(configCommand(options)).rejects.toThrow("Process exit");

      expect(logger.info).toHaveBeenCalledWith("Initializing configuration...");
      expect(fileExists).toHaveBeenCalledWith("rulesync.jsonc");
      expect(logger.error).toHaveBeenCalledWith("rulesync.jsonc already exists");
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should create configuration file with correct default values", async () => {
      const options: ConfigCommandOptions = { init: true };

      await configCommand(options);

      expect(writeFileContent).toHaveBeenCalledWith(
        "rulesync.jsonc",
        expect.stringMatching(/\{[\s\S]*\}/),
      );

      // Get the actual call to inspect the JSON content
      const writeCall = vi.mocked(writeFileContent).mock.calls[0];
      expect(writeCall).toBeDefined();
      const jsonContent = writeCall![1];
      const configObject = JSON.parse(jsonContent);

      expect(configObject).toEqual({
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: ["rules", "ignore", "mcp", "commands", "subagents"],
        baseDirs: ["."],
        delete: true,
        verbose: false,
        experimentalGlobal: false,
        experimentalSimulateCommands: false,
        experimentalSimulateSubagents: false,
      });
    });

    it("should format JSON with proper indentation", async () => {
      const options: ConfigCommandOptions = { init: true };

      await configCommand(options);

      const writeCall = vi.mocked(writeFileContent).mock.calls[0];
      expect(writeCall).toBeDefined();
      const jsonContent = writeCall![1];

      // Check that it's properly formatted (indented)
      expect(jsonContent).toMatch(/^\{[\s\S]*\}$/);
      expect(jsonContent).toContain("  "); // Should contain indentation
      expect(jsonContent.split("\n").length).toBeGreaterThan(1); // Should be multiline
    });
  });

  describe("experimentalGlobal configuration", () => {
    it("should include experimentalGlobal set to false by default", async () => {
      const options: ConfigCommandOptions = { init: true };

      await configCommand(options);

      const writeCall = vi.mocked(writeFileContent).mock.calls[0];
      const jsonContent = writeCall![1];
      const configObject = JSON.parse(jsonContent);

      expect(configObject).toHaveProperty("experimentalGlobal");
      expect(configObject.experimentalGlobal).toBe(false);
    });

    it("should include experimentalGlobal in the generated config alongside other experimental features", async () => {
      const options: ConfigCommandOptions = { init: true };

      await configCommand(options);

      const writeCall = vi.mocked(writeFileContent).mock.calls[0];
      const jsonContent = writeCall![1];
      const configObject = JSON.parse(jsonContent);

      // Verify all experimental features are present
      expect(configObject).toHaveProperty("experimentalGlobal");
      expect(configObject).toHaveProperty("experimentalSimulateCommands");
      expect(configObject).toHaveProperty("experimentalSimulateSubagents");

      // All should default to false
      expect(configObject.experimentalGlobal).toBe(false);
      expect(configObject.experimentalSimulateCommands).toBe(false);
      expect(configObject.experimentalSimulateSubagents).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle file existence check errors", async () => {
      vi.mocked(fileExists).mockRejectedValue(new Error("File system error"));
      const options: ConfigCommandOptions = { init: true };

      await expect(configCommand(options)).rejects.toThrow("File system error");

      expect(logger.info).toHaveBeenCalledWith("Initializing configuration...");
      expect(fileExists).toHaveBeenCalledWith("rulesync.jsonc");
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should handle file write errors", async () => {
      vi.mocked(writeFileContent).mockRejectedValue(new Error("Write error"));
      const options: ConfigCommandOptions = { init: true };

      await expect(configCommand(options)).rejects.toThrow("Write error");

      expect(logger.info).toHaveBeenCalledWith("Initializing configuration...");
      expect(fileExists).toHaveBeenCalledWith("rulesync.jsonc");
      expect(writeFileContent).toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalled();
    });
  });
});
