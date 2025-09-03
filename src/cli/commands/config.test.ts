import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import * as fileUtils from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { configCommand } from "./config.js";

vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");

describe("configCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    process.chdir(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("when init option is not provided", () => {
    it("should show info message", async () => {
      await configCommand({});

      expect(logger.info).toHaveBeenCalledWith(
        "Please run `rulesync config --init` to create a new configuration file",
      );
    });
  });

  describe("when init option is provided", () => {
    it("should create rulesync.jsonc file with default configuration", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

      await configCommand({ init: true });

      expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
        "rulesync.jsonc",
        expect.stringContaining('"targets": ["copilot", "cursor", "claudecode", "codexcli"]'),
      );
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
        "rulesync.jsonc",
        expect.stringContaining('"features": ["rules", "ignore", "mcp", "commands", "subagents"]'),
      );
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
        "rulesync.jsonc",
        expect.stringContaining('"baseDirs": ["."]'),
      );
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
        "rulesync.jsonc",
        expect.stringContaining('"delete": true'),
      );
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
        "rulesync.jsonc",
        expect.stringContaining('"verbose": false'),
      );

      expect(logger.success).toHaveBeenCalledWith("Configuration file created successfully!");
    });

    it("should exit with error if rulesync.jsonc already exists", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);

      await configCommand({ init: true });

      expect(logger.error).toHaveBeenCalledWith("rulesync.jsonc already exists");
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it("should properly format JSON configuration", async () => {
      vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

      await configCommand({ init: true });

      const writeCall = vi.mocked(fileUtils.writeFileContent).mock.calls[0];
      expect(writeCall).toBeDefined();
      const jsonContent = writeCall![1];

      // Should be properly formatted JSON (with 2 spaces)
      expect(jsonContent).toContain('  "targets":');
      expect(jsonContent).toContain('  "features":');

      // Should be valid JSON
      expect(() => JSON.parse(jsonContent)).not.toThrow();
    });
  });
});
