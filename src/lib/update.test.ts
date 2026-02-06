import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  compareVersions,
  detectExecutionEnvironment,
  getHomebrewUpgradeInstructions,
  getNpmUpgradeInstructions,
  getPlatformAssetName,
  normalizeVersion,
  parseSha256Sums,
  performBinaryUpdate,
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
    let originalArgv: string[];

    beforeEach(() => {
      originalExecPath = process.execPath;
      originalArgv = [...process.argv];
    });

    afterEach(() => {
      Object.defineProperty(process, "execPath", {
        value: originalExecPath,
        configurable: true,
        writable: true,
      });
      process.argv = originalArgv;
    });

    it("should detect homebrew when rulesync binary is in /opt/homebrew/", () => {
      Object.defineProperty(process, "execPath", {
        value: "/opt/homebrew/bin/rulesync",
        configurable: true,
      });
      expect(detectExecutionEnvironment()).toBe("homebrew");
    });

    it("should detect homebrew when rulesync binary is in /usr/local/Cellar/", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/Cellar/rulesync/1.0.0/bin/rulesync",
        configurable: true,
      });
      expect(detectExecutionEnvironment()).toBe("homebrew");
    });

    it("should detect homebrew via script path when Node is in Homebrew", () => {
      Object.defineProperty(process, "execPath", {
        value: "/opt/homebrew/bin/node",
        configurable: true,
      });
      process.argv = [
        "/opt/homebrew/bin/node",
        "/opt/homebrew/lib/node_modules/rulesync/dist/index.js",
      ];
      expect(detectExecutionEnvironment()).toBe("homebrew");
    });

    it("should detect npm when Node is in Homebrew but script is NOT rulesync related", () => {
      Object.defineProperty(process, "execPath", {
        value: "/opt/homebrew/bin/node",
        configurable: true,
      });
      process.argv = ["/opt/homebrew/bin/node", "/usr/local/lib/node_modules/other-tool/index.js"];
      expect(detectExecutionEnvironment()).toBe("npm");
    });

    it("should detect single-binary for rulesync binary path", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/bin/rulesync",
        configurable: true,
      });
      expect(detectExecutionEnvironment()).toBe("single-binary");
    });

    it("should detect single-binary for platform-specific binary path", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/bin/rulesync-linux-x64",
        configurable: true,
      });
      expect(detectExecutionEnvironment()).toBe("single-binary");
    });

    it("should detect single-binary for Windows binary", () => {
      Object.defineProperty(process, "execPath", {
        value: "C:\\Program Files\\rulesync.exe",
        configurable: true,
      });
      expect(detectExecutionEnvironment()).toBe("single-binary");
    });

    it("should detect npm for Node.js binary paths", () => {
      Object.defineProperty(process, "execPath", {
        value: "/home/user/.nvm/versions/node/v20.0.0/bin/node",
        configurable: true,
      });
      process.argv = [
        "/home/user/.nvm/versions/node/v20.0.0/bin/node",
        "/home/user/project/node_modules/.bin/rulesync",
      ];
      expect(detectExecutionEnvironment()).toBe("npm");
    });

    it("should default to npm for unknown paths", () => {
      Object.defineProperty(process, "execPath", {
        value: "/usr/bin/node",
        configurable: true,
      });
      process.argv = ["/usr/bin/node", "/some/script.js"];
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

    it("should reject github.com URLs with wrong repo path", () => {
      expect(() =>
        validateDownloadUrl(
          "https://github.com/evil-org/evil-repo/releases/download/v1.0.0/binary",
        ),
      ).toThrow("must belong to dyoshikawa/rulesync");
    });

    it("should accept github.com URLs with correct repo path", () => {
      expect(() =>
        validateDownloadUrl(
          "https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/rulesync-linux-x64",
        ),
      ).not.toThrow();
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

  describe("performBinaryUpdate", () => {
    let testDir: string;
    let cleanup: () => Promise<void>;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
      ({ testDir, cleanup } = await setupTestDirectory());
      originalFetch = globalThis.fetch;
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await cleanup();
    });

    it("should return already-at-latest message when no update available", async () => {
      const { GitHubClient } = await import("./github-client.js");
      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v1.0.0",
        name: "v1.0.0",
        prerelease: false,
        draft: false,
        assets: [],
      });

      const result = await performBinaryUpdate("1.0.0");
      expect(result).toContain("Already at the latest version");
    });

    it("should throw when platform is unsupported", async () => {
      const { GitHubClient } = await import("./github-client.js");
      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v2.0.0",
        name: "v2.0.0",
        prerelease: false,
        draft: false,
        assets: [],
      });
      vi.spyOn(process, "platform", "get").mockReturnValue("freebsd");
      vi.spyOn(process, "arch", "get").mockReturnValue("x64");

      await expect(performBinaryUpdate("1.0.0")).rejects.toThrow("Unsupported platform");
    });

    it("should throw when binary asset is not found in release", async () => {
      const { GitHubClient } = await import("./github-client.js");
      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v2.0.0",
        name: "v2.0.0",
        prerelease: false,
        draft: false,
        assets: [
          {
            name: "other-file",
            browser_download_url:
              "https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/other-file",
            size: 100,
          },
        ],
      });

      await expect(performBinaryUpdate("1.0.0")).rejects.toThrow("not found in release");
    });

    it("should throw when SHA256SUMS asset is not found in release", async () => {
      const { GitHubClient } = await import("./github-client.js");
      const assetName = getPlatformAssetName();
      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v2.0.0",
        name: "v2.0.0",
        prerelease: false,
        draft: false,
        assets: [
          {
            name: assetName!,
            browser_download_url: `https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/${assetName}`,
            size: 100,
          },
        ],
      });

      await expect(performBinaryUpdate("1.0.0")).rejects.toThrow("SHA256SUMS not found");
    });

    it("should throw when checksum verification fails", async () => {
      const { GitHubClient } = await import("./github-client.js");
      const assetName = getPlatformAssetName()!;

      // Create fake binary content
      const fakeBinaryContent = Buffer.from("fake-binary-content");
      const wrongChecksum = "0".repeat(64);

      const sha256sumsContent = `${wrongChecksum}  ${assetName}\n`;

      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v2.0.0",
        name: "v2.0.0",
        prerelease: false,
        draft: false,
        assets: [
          {
            name: assetName,
            browser_download_url: `https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/${assetName}`,
            size: fakeBinaryContent.length,
          },
          {
            name: "SHA256SUMS",
            browser_download_url:
              "https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/SHA256SUMS",
            size: sha256sumsContent.length,
          },
        ],
      });

      // Mock fetch to return our fake content
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const body = url.includes("SHA256SUMS")
          ? Buffer.from(sha256sumsContent)
          : fakeBinaryContent;
        const readableStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(body));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(readableStream, {
            status: 200,
            headers: { "content-length": String(body.length) },
          }),
        );
      });

      await expect(performBinaryUpdate("1.0.0")).rejects.toThrow("Checksum verification failed");
    });

    it("should successfully update binary when checksum matches", async () => {
      const { GitHubClient } = await import("./github-client.js");
      const assetName = getPlatformAssetName()!;

      // Create a fake executable in testDir to act as current binary
      const fakeExePath = path.join(testDir, "rulesync");
      await fs.promises.writeFile(fakeExePath, "old-binary");
      await fs.promises.chmod(fakeExePath, 0o755);

      // Mock process.execPath to point to our fake binary
      Object.defineProperty(process, "execPath", {
        value: fakeExePath,
        configurable: true,
        writable: true,
      });

      // Create fake new binary content
      const newBinaryContent = Buffer.from("new-binary-content");
      const checksum = crypto.createHash("sha256").update(newBinaryContent).digest("hex");
      const sha256sumsContent = `${checksum}  ${assetName}\n`;

      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v2.0.0",
        name: "v2.0.0",
        prerelease: false,
        draft: false,
        assets: [
          {
            name: assetName,
            browser_download_url: `https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/${assetName}`,
            size: newBinaryContent.length,
          },
          {
            name: "SHA256SUMS",
            browser_download_url:
              "https://github.com/dyoshikawa/rulesync/releases/download/v2.0.0/SHA256SUMS",
            size: sha256sumsContent.length,
          },
        ],
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const body = url.includes("SHA256SUMS") ? Buffer.from(sha256sumsContent) : newBinaryContent;
        const readableStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(body));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(readableStream, {
            status: 200,
            headers: { "content-length": String(body.length) },
          }),
        );
      });

      const result = await performBinaryUpdate("1.0.0");
      expect(result).toContain("Successfully updated from 1.0.0 to 2.0.0");

      // Verify the binary was replaced
      const updatedContent = await fs.promises.readFile(fakeExePath);
      expect(updatedContent.toString()).toBe("new-binary-content");
    });

    it("should perform update when force is true even at latest version", async () => {
      const { GitHubClient } = await import("./github-client.js");
      const assetName = getPlatformAssetName()!;

      const fakeExePath = path.join(testDir, "rulesync");
      await fs.promises.writeFile(fakeExePath, "old-binary");
      await fs.promises.chmod(fakeExePath, 0o755);

      Object.defineProperty(process, "execPath", {
        value: fakeExePath,
        configurable: true,
        writable: true,
      });

      const newBinaryContent = Buffer.from("forced-binary-content");
      const checksum = crypto.createHash("sha256").update(newBinaryContent).digest("hex");
      const sha256sumsContent = `${checksum}  ${assetName}\n`;

      vi.spyOn(GitHubClient.prototype, "getLatestRelease").mockResolvedValue({
        tag_name: "v1.0.0",
        name: "v1.0.0",
        prerelease: false,
        draft: false,
        assets: [
          {
            name: assetName,
            browser_download_url: `https://github.com/dyoshikawa/rulesync/releases/download/v1.0.0/${assetName}`,
            size: newBinaryContent.length,
          },
          {
            name: "SHA256SUMS",
            browser_download_url:
              "https://github.com/dyoshikawa/rulesync/releases/download/v1.0.0/SHA256SUMS",
            size: sha256sumsContent.length,
          },
        ],
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const body = url.includes("SHA256SUMS") ? Buffer.from(sha256sumsContent) : newBinaryContent;
        const readableStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(body));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(readableStream, {
            status: 200,
            headers: { "content-length": String(body.length) },
          }),
        );
      });

      const result = await performBinaryUpdate("1.0.0", { force: true });
      expect(result).toContain("Successfully updated");
    });
  });
});
