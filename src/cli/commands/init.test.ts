import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { init } from "../../lib/init.js";
import { logger } from "../../utils/logger.js";
import { initCommand } from "./init.js";

// Mock dependencies
vi.mock("../../lib/init.js");
vi.mock("../../utils/logger.js");

describe("initCommand", () => {
  beforeEach(() => {
    // Setup logger mocks
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup default mock for init
    vi.mocked(init).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("calling core init function", () => {
    it("should call init from core", async () => {
      await initCommand();

      expect(init).toHaveBeenCalled();
    });
  });

  describe("logging behavior", () => {
    it("should log initialization start message first", async () => {
      await initCommand();

      const loggerInfoCalls = vi.mocked(logger.info).mock.calls;
      expect(loggerInfoCalls[0]?.[0]).toBe("Initializing rulesync...");
    });

    it("should log success message after initialization", async () => {
      await initCommand();

      expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
    });

    it("should log next steps instructions", async () => {
      await initCommand();

      expect(logger.info).toHaveBeenCalledWith("Next steps:");
      expect(logger.info).toHaveBeenCalledWith(
        `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/skills/*/${SKILL_FILE_NAME}, ${RULESYNC_MCP_RELATIVE_FILE_PATH} and ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
      expect(logger.info).toHaveBeenCalledWith(
        "2. Run 'rulesync generate' to create configuration files",
      );
    });

    it("should log messages in correct order", async () => {
      const logOrder: string[] = [];
      vi.mocked(logger.info).mockImplementation((msg) => {
        logOrder.push(`info:${msg}`);
      });
      vi.mocked(logger.success).mockImplementation((msg) => {
        logOrder.push(`success:${msg}`);
      });

      await initCommand();

      expect(logOrder[0]).toBe("info:Initializing rulesync...");
      expect(logOrder[1]).toBe("success:rulesync initialized successfully!");
      expect(logOrder[2]).toBe("info:Next steps:");
    });
  });

  describe("error handling", () => {
    it("should propagate errors from init function", async () => {
      vi.mocked(init).mockRejectedValue(new Error("Permission denied"));

      await expect(initCommand()).rejects.toThrow("Permission denied");

      expect(logger.info).toHaveBeenCalledWith("Initializing rulesync...");
      expect(logger.success).not.toHaveBeenCalled();
    });

    it("should not log success when init fails", async () => {
      vi.mocked(init).mockRejectedValue(new Error("Disk full"));

      await expect(initCommand()).rejects.toThrow("Disk full");

      expect(logger.success).not.toHaveBeenCalled();
    });
  });
});
