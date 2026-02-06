import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubClientError } from "../../lib/github-client.js";
import {
  UpdatePermissionError,
  checkForUpdate,
  detectExecutionEnvironment,
  getHomebrewUpgradeInstructions,
  getNpmUpgradeInstructions,
  performBinaryUpdate,
} from "../../lib/update.js";
import { logger } from "../../utils/logger.js";
import { updateCommand } from "./update.js";

vi.mock("../../lib/update.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/update.js")>();
  return {
    UpdatePermissionError: actual.UpdatePermissionError,
    detectExecutionEnvironment: vi.fn(),
    checkForUpdate: vi.fn(),
    performBinaryUpdate: vi.fn(),
    getNpmUpgradeInstructions: vi.fn(),
    getHomebrewUpgradeInstructions: vi.fn(),
  };
});
vi.mock("../../lib/github-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/github-client.js")>();
  return {
    ...actual,
    GitHubClientError: actual.GitHubClientError,
  };
});
vi.mock("../../utils/logger.js");

describe("updateCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("Process exit");
    } as never);

    vi.mocked(logger.configure).mockImplementation(() => {});
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.debug).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("npm environment", () => {
    it("should show npm upgrade instructions", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("npm");
      vi.mocked(getNpmUpgradeInstructions).mockReturnValue("npm install -g rulesync@latest");

      await updateCommand("1.0.0", {});

      expect(logger.info).toHaveBeenCalledWith("npm install -g rulesync@latest");
      expect(performBinaryUpdate).not.toHaveBeenCalled();
    });
  });

  describe("homebrew environment", () => {
    it("should show homebrew upgrade instructions", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("homebrew");
      vi.mocked(getHomebrewUpgradeInstructions).mockReturnValue("brew upgrade rulesync");

      await updateCommand("1.0.0", {});

      expect(logger.info).toHaveBeenCalledWith("brew upgrade rulesync");
      expect(performBinaryUpdate).not.toHaveBeenCalled();
    });
  });

  describe("single-binary environment with --check", () => {
    it("should report update available when newer version exists", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(checkForUpdate).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        release: {
          tag_name: "v2.0.0",
          name: "v2.0.0",
          prerelease: false,
          draft: false,
          assets: [],
        },
      });

      await updateCommand("1.0.0", { check: true });

      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("Update available: 1.0.0 -> 2.0.0"),
      );
    });

    it("should report already at latest when no update available", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(checkForUpdate).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdate: false,
        release: {
          tag_name: "v1.0.0",
          name: "v1.0.0",
          prerelease: false,
          draft: false,
          assets: [],
        },
      });

      await updateCommand("1.0.0", { check: true });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Already at the latest version"),
      );
    });
  });

  describe("single-binary environment update", () => {
    it("should perform update and log success message", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(performBinaryUpdate).mockResolvedValue("Successfully updated from 1.0.0 to 2.0.0");

      await updateCommand("1.0.0", {});

      expect(performBinaryUpdate).toHaveBeenCalledWith("1.0.0", { force: false, token: undefined });
      expect(logger.success).toHaveBeenCalledWith("Successfully updated from 1.0.0 to 2.0.0");
    });

    it("should pass force and token options", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(performBinaryUpdate).mockResolvedValue("Successfully updated");

      await updateCommand("1.0.0", { force: true, token: "my-token" });

      expect(performBinaryUpdate).toHaveBeenCalledWith("1.0.0", { force: true, token: "my-token" });
    });
  });

  describe("error handling", () => {
    it("should handle GitHubClientError and exit with 1", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(performBinaryUpdate).mockRejectedValue(
        new GitHubClientError("Rate limit exceeded", 403),
      );

      await expect(updateCommand("1.0.0", {})).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith("GitHub API Error: Rate limit exceeded");
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should not show token tip for non-auth GitHub errors", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(performBinaryUpdate).mockRejectedValue(new GitHubClientError("Not found", 404));

      await expect(updateCommand("1.0.0", {})).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith("GitHub API Error: Not found");
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN"));
    });

    it("should handle UpdatePermissionError and suggest sudo", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(performBinaryUpdate).mockRejectedValue(
        new UpdatePermissionError("Permission denied: Cannot write to /usr/local/bin"),
      );

      await expect(updateCommand("1.0.0", {})).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(
        "Permission denied: Cannot write to /usr/local/bin",
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("sudo"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle generic errors", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("single-binary");
      vi.mocked(performBinaryUpdate).mockRejectedValue(new Error("Network error"));

      await expect(updateCommand("1.0.0", {})).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith("Error: Network error");
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("logger configuration", () => {
    it("should configure logger with verbose and silent options", async () => {
      vi.mocked(detectExecutionEnvironment).mockReturnValue("npm");
      vi.mocked(getNpmUpgradeInstructions).mockReturnValue("instructions");

      await updateCommand("1.0.0", { verbose: true, silent: true });

      expect(logger.configure).toHaveBeenCalledWith({ verbose: true, silent: true });
    });
  });
});
