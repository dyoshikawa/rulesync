import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger.js";

// Mock consola
vi.mock("consola", () => {
  const mockConsola = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    withDefaults: vi.fn(() => mockConsola),
  };
  return { consola: mockConsola };
});

// Mock vitest module
vi.mock("./vitest.js", () => ({
  isEnvTest: false,
}));

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset logger state
    logger.configure({ verbose: false, silent: false });
  });

  describe("configure()", () => {
    it("should set verbose and silent flags", () => {
      logger.configure({ verbose: true, silent: false });
      expect(logger.verbose).toBe(true);
      expect(logger.silent).toBe(false);

      logger.configure({ verbose: false, silent: true });
      expect(logger.verbose).toBe(false);
      expect(logger.silent).toBe(true);
    });

    it("should warn when both verbose and silent are enabled", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: true, silent: true });

      expect(consola.warn).toHaveBeenCalledWith(
        "Both --verbose and --silent specified; --silent takes precedence",
      );
    });

    it("should not warn when only one flag is enabled", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: true, silent: false });
      expect(consola.warn).not.toHaveBeenCalled();

      vi.clearAllMocks();

      logger.configure({ verbose: false, silent: true });
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should not warn when both flags are disabled", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: false });
      expect(consola.warn).not.toHaveBeenCalled();
    });
  });

  describe("silent mode", () => {
    it("should suppress info messages in silent mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: true });
      logger.info("test message");

      expect(consola.info).not.toHaveBeenCalled();
    });

    it("should suppress success messages in silent mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: true });
      logger.success("test message");

      expect(consola.success).not.toHaveBeenCalled();
    });

    it("should suppress warning messages in silent mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: true });
      logger.warn("test message");

      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should NOT suppress error messages in silent mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: true });
      logger.error("test error");

      expect(consola.error).toHaveBeenCalledWith("test error");
    });

    it("should suppress debug messages in silent mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: true, silent: true });
      logger.debug("test debug");

      expect(consola.info).not.toHaveBeenCalled();
    });
  });

  describe("verbose mode", () => {
    it("should show debug messages in verbose mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: true, silent: false });
      logger.debug("test debug");

      expect(consola.info).toHaveBeenCalledWith("test debug");
    });

    it("should not show debug messages when verbose is disabled", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: false });
      logger.debug("test debug");

      expect(consola.info).not.toHaveBeenCalled();
    });
  });

  describe("normal mode", () => {
    it("should show info messages in normal mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: false });
      logger.info("test message");

      expect(consola.info).toHaveBeenCalledWith("test message");
    });

    it("should show success messages in normal mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: false });
      logger.success("test message");

      expect(consola.success).toHaveBeenCalledWith("test message");
    });

    it("should show warning messages in normal mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: false });
      logger.warn("test message");

      expect(consola.warn).toHaveBeenCalledWith("test message");
    });

    it("should show error messages in normal mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: false, silent: false });
      logger.error("test error");

      expect(consola.error).toHaveBeenCalledWith("test error");
    });
  });

  describe("precedence", () => {
    it("should prioritize silent mode over verbose mode", async () => {
      const { consola } = await import("consola");

      logger.configure({ verbose: true, silent: true });

      // Debug should not show (suppressed by silent)
      logger.debug("test debug");
      expect(consola.info).not.toHaveBeenCalled();

      // Info should not show (suppressed by silent)
      logger.info("test info");
      expect(consola.info).not.toHaveBeenCalled();

      // Errors should still show
      logger.error("test error");
      expect(consola.error).toHaveBeenCalledWith("test error");
    });
  });
});
