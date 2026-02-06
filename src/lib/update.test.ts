import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  detectExecutionEnvironment,
  getHomebrewUpgradeInstructions,
  getNpmUpgradeInstructions,
  getPlatformAssetName,
  normalizeVersion,
  parseSha256Sums,
  validateDownloadUrl,
} from "./update.js";

describe("update", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("normalizeVersion", () => {
    it("should remove leading v", () => {
      expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    });

    it("should return version as-is if no leading v", () => {
      expect(normalizeVersion("1.2.3")).toBe("1.2.3");
    });

    it("should strip pre-release suffix", () => {
      expect(normalizeVersion("1.2.3-beta.1")).toBe("1.2.3");
    });

    it("should strip pre-release suffix with leading v", () => {
      expect(normalizeVersion("v1.2.3-rc.1")).toBe("1.2.3");
    });
  });

  describe("compareVersions", () => {
    it("should return 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("should return 1 when a > b (major)", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    });

    it("should return -1 when a < b (major)", () => {
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    });

    it("should return 1 when a > b (minor)", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBe(1);
    });

    it("should return -1 when a < b (patch)", () => {
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    });

    it("should handle versions with leading v", () => {
      expect(compareVersions("v1.2.0", "v1.1.0")).toBe(1);
    });

    it("should handle uneven segment counts", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
    });

    it("should handle uneven segments where one is longer", () => {
      expect(compareVersions("1.0.1", "1.0")).toBe(1);
    });

    it("should strip pre-release suffixes before comparing", () => {
      expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    });

    it("should throw on invalid version format", () => {
      expect(() => compareVersions("abc", "1.0.0")).toThrow("Invalid version format");
    });
  });

  describe("detectExecutionEnvironment", () => {
    let originalExecPath: string;

    beforeEach(() => {
      originalExecPath = process.execPath;
    });

    afterEach(() => {
      Object.defineProperty(process, "execPath", { value: originalExecPath });
    });

    it("should detect homebrew from /opt/homebrew/", () => {
      Object.defineProperty(process, "execPath", {
        value: "/opt/homebrew/bin/node",
      });
      expect(detectExecutionEnvironment()).toBe("homebrew");
    });

    it("should detect homebrew from /usr/local/Cellar/", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/Cellar/node/20.0.0/bin/node",
      });
      expect(detectExecutionEnvironment()).toBe("homebrew");
    });

    it("should detect single-binary for rulesync binary path", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/bin/rulesync",
      });
      expect(detectExecutionEnvironment()).toBe("single-binary");
    });

    it("should detect single-binary for platform-specific binary path", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/bin/rulesync-linux-x64",
      });
      expect(detectExecutionEnvironment()).toBe("single-binary");
    });

    it("should detect single-binary for Windows binary", () => {
      Object.defineProperty(process, "execPath", {
        value: "C:\\Program Files\\rulesync.exe",
      });
      expect(detectExecutionEnvironment()).toBe("single-binary");
    });

    it("should detect npm when path contains node_modules", () => {
      Object.defineProperty(process, "execPath", {
        value: "/home/user/.nvm/versions/node/v20.0.0/bin/node",
      });
      expect(detectExecutionEnvironment()).toBe("npm");
    });

    it("should default to npm for unknown paths", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/bin/node",
      });
      expect(detectExecutionEnvironment()).toBe("npm");
    });
  });

  describe("getPlatformAssetName", () => {
    it("should return correct name for linux x64", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      vi.spyOn(process, "arch", "get").mockReturnValue("x64");
      expect(getPlatformAssetName()).toBe("rulesync-linux-x64");
    });

    it("should return correct name for darwin arm64", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
      expect(getPlatformAssetName()).toBe("rulesync-darwin-arm64");
    });

    it("should return correct name for windows x64 with .exe extension", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      vi.spyOn(process, "arch", "get").mockReturnValue("x64");
      expect(getPlatformAssetName()).toBe("rulesync-windows-x64.exe");
    });

    it("should return null for unsupported platform", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("freebsd");
      vi.spyOn(process, "arch", "get").mockReturnValue("x64");
      expect(getPlatformAssetName()).toBeNull();
    });

    it("should return null for unsupported architecture", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      vi.spyOn(process, "arch", "get").mockReturnValue("s390x");
      expect(getPlatformAssetName()).toBeNull();
    });
  });

  describe("parseSha256Sums", () => {
    it("should parse well-formed SHA256SUMS content", () => {
      const hash1 = "a".repeat(64);
      const hash2 = "b".repeat(64);
      const content = [`${hash1}  rulesync-linux-x64`, `${hash2}  rulesync-darwin-arm64`].join(
        "\n",
      );

      const result = parseSha256Sums(content);
      expect(result.size).toBe(2);
      expect(result.get("rulesync-linux-x64")).toBe(hash1);
      expect(result.get("rulesync-darwin-arm64")).toBe(hash2);
    });

    it("should handle empty content", () => {
      expect(parseSha256Sums("").size).toBe(0);
    });

    it("should skip blank lines", () => {
      const hash1 = "a".repeat(64);
      const hash2 = "b".repeat(64);
      const content = [`${hash1}  file1`, "", "   ", `${hash2}  file2`].join("\n");

      const result = parseSha256Sums(content);
      expect(result.size).toBe(2);
    });

    it("should skip malformed lines", () => {
      const validHash = "a".repeat(64);
      const content = ["not-a-hash  file1", `${validHash}  valid-file`].join("\n");

      const result = parseSha256Sums(content);
      expect(result.size).toBe(1);
      expect(result.get("valid-file")).toBeDefined();
    });
  });

  describe("validateDownloadUrl", () => {
    it("should accept valid GitHub HTTPS URLs", () => {
      expect(() =>
        validateDownloadUrl(
          "https://github.com/dyoshikawa/rulesync/releases/download/v1.0.0/rulesync-linux-x64",
        ),
      ).not.toThrow();
    });

    it("should accept objects.githubusercontent.com URLs", () => {
      expect(() =>
        validateDownloadUrl("https://objects.githubusercontent.com/some/path/to/asset"),
      ).not.toThrow();
    });

    it("should accept github-releases.githubusercontent.com URLs", () => {
      expect(() =>
        validateDownloadUrl("https://github-releases.githubusercontent.com/some/path/to/asset"),
      ).not.toThrow();
    });

    it("should reject HTTP URLs", () => {
      expect(() =>
        validateDownloadUrl("http://github.com/dyoshikawa/rulesync/releases/download/v1.0.0/file"),
      ).toThrow("must use HTTPS");
    });

    it("should reject non-GitHub domains", () => {
      expect(() => validateDownloadUrl("https://evil.com/malicious-binary")).toThrow(
        "not in the allowed list",
      );
    });

    it("should reject invalid URLs", () => {
      expect(() => validateDownloadUrl("not-a-url")).toThrow("Invalid download URL");
    });
  });

  describe("getNpmUpgradeInstructions", () => {
    it("should include npm install command", () => {
      const instructions = getNpmUpgradeInstructions();
      expect(instructions).toContain("npm install -g rulesync@latest");
    });
  });

  describe("getHomebrewUpgradeInstructions", () => {
    it("should include brew upgrade command", () => {
      const instructions = getHomebrewUpgradeInstructions();
      expect(instructions).toContain("brew upgrade rulesync");
    });
  });
});
