import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { GitHubRelease, GitHubReleaseAsset } from "../types/fetch.js";

import { GitHubClient } from "./github-client.js";

const RULESYNC_REPO_OWNER = "dyoshikawa";
const RULESYNC_REPO_NAME = "rulesync";

/**
 * Maximum download size (500MB) to prevent memory exhaustion
 */
const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024;

/**
 * Allowed domains for downloading release assets
 */
const ALLOWED_DOWNLOAD_DOMAINS = [
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
];

/**
 * Execution environment types for rulesync
 */
export type ExecutionEnvironment = "single-binary" | "homebrew" | "npm";

/**
 * Update check result
 */
export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  release: GitHubRelease;
};

/**
 * Custom error for permission issues during update
 */
export class UpdatePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdatePermissionError";
  }
}

/**
 * Detect the execution environment of rulesync
 */
export function detectExecutionEnvironment(): ExecutionEnvironment {
  const execPath = process.execPath;

  // Homebrew detection: /opt/homebrew/ or /usr/local/Cellar/
  if (execPath.includes("/homebrew/") || execPath.includes("/Cellar/")) {
    return "homebrew";
  }

  // Single binary detection: no node_modules & rulesync binary name
  const noNodeModules = !execPath.includes("node_modules");
  const isRulesyncBinary = /rulesync(-[a-z0-9]+(-[a-z0-9]+)?)?(\.exe)?$/i.test(execPath);
  if (noNodeModules && isRulesyncBinary) {
    return "single-binary";
  }

  return "npm";
}

/**
 * Get the asset name for the current platform
 */
export function getPlatformAssetName(): string | null {
  const platform = os.platform();
  const arch = os.arch();

  // Map Node.js platform/arch to asset names
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };

  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
  };

  const platformName = platformMap[platform];
  const archName = archMap[arch];

  if (!platformName || !archName) {
    return null;
  }

  const extension = platform === "win32" ? ".exe" : "";
  return `rulesync-${platformName}-${archName}${extension}`;
}

/**
 * Normalize version string by removing leading 'v' and stripping pre-release suffix
 */
export function normalizeVersion(v: string): string {
  // Remove leading 'v' and strip pre-release suffix (e.g., "1.2.3-beta.1" -> "1.2.3")
  return v.replace(/^v/, "").replace(/-.*$/, "");
}

/**
 * Compare semantic versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const aParts = normalizeVersion(a).split(".").map(Number);
  const bParts = normalizeVersion(b).split(".").map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aNum = aParts[i] ?? 0;
    const bNum = bParts[i] ?? 0;
    if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) {
      throw new Error(`Invalid version format: cannot compare "${a}" and "${b}"`);
    }
    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
  }
  return 0;
}

/**
 * Validate that a download URL is safe (HTTPS + allowed GitHub domain)
 */
export function validateDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid download URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Download URL must use HTTPS: ${url}`);
  }

  const isAllowed = ALLOWED_DOWNLOAD_DOMAINS.some((domain) => parsed.hostname === domain);
  if (!isAllowed) {
    throw new Error(
      `Download URL domain "${parsed.hostname}" is not in the allowed list: ${ALLOWED_DOWNLOAD_DOMAINS.join(", ")}`,
    );
  }
}

/**
 * Check for updates
 */
export async function checkForUpdate(
  currentVersion: string,
  token?: string,
): Promise<UpdateCheckResult> {
  const client = new GitHubClient({
    token: GitHubClient.resolveToken(token),
  });

  const release = await client.getLatestRelease(RULESYNC_REPO_OWNER, RULESYNC_REPO_NAME);
  const latestVersion = normalizeVersion(release.tag_name);
  const normalizedCurrentVersion = normalizeVersion(currentVersion);

  return {
    currentVersion: normalizedCurrentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, normalizedCurrentVersion) > 0,
    release,
  };
}

/**
 * Find asset by name in release
 */
function findAsset(release: GitHubRelease, assetName: string): GitHubReleaseAsset | null {
  return release.assets.find((asset) => asset.name === assetName) ?? null;
}

/**
 * Download a file from URL to a destination path
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  validateDownloadUrl(url);

  const response = await fetch(url, {
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to download: HTTP ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_SIZE) {
    throw new Error(
      `Download too large: ${contentLength} bytes exceeds limit of ${MAX_DOWNLOAD_SIZE} bytes`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > MAX_DOWNLOAD_SIZE) {
    throw new Error(
      `Download too large: ${buffer.length} bytes exceeds limit of ${MAX_DOWNLOAD_SIZE} bytes`,
    );
  }

  await fs.promises.writeFile(destPath, buffer);
}

/**
 * Calculate SHA256 checksum of a file
 */
async function calculateSha256(filePath: string): Promise<string> {
  const content = await fs.promises.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Parse SHA256SUMS file content
 */
export function parseSha256Sums(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "hash  filename" (two spaces between hash and filename)
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(trimmed);
    if (match && match[1] && match[2]) {
      result.set(match[2], match[1]);
    }
  }
  return result;
}

/**
 * Update options
 */
export type UpdateOptions = {
  force?: boolean;
  token?: string;
};

/**
 * Perform the binary update
 */
export async function performBinaryUpdate(
  currentVersion: string,
  options: UpdateOptions = {},
): Promise<string> {
  const { force = false, token } = options;

  // Check for updates
  const updateCheck = await checkForUpdate(currentVersion, token);

  if (!updateCheck.hasUpdate && !force) {
    return `Already at the latest version (${currentVersion})`;
  }

  // Get platform-specific asset name
  const assetName = getPlatformAssetName();
  if (!assetName) {
    throw new Error(
      `Unsupported platform: ${os.platform()} ${os.arch()}. Please download manually from https://github.com/${RULESYNC_REPO_OWNER}/${RULESYNC_REPO_NAME}/releases`,
    );
  }

  // Find the binary asset
  const binaryAsset = findAsset(updateCheck.release, assetName);
  if (!binaryAsset) {
    throw new Error(
      `Binary for ${assetName} not found in release. Please download manually from https://github.com/${RULESYNC_REPO_OWNER}/${RULESYNC_REPO_NAME}/releases`,
    );
  }

  // Find the SHA256SUMS asset for verification (mandatory)
  const checksumAsset = findAsset(updateCheck.release, "SHA256SUMS");
  if (!checksumAsset) {
    throw new Error(
      "SHA256SUMS not found in release. Cannot verify download integrity. Please download manually from " +
        `https://github.com/${RULESYNC_REPO_OWNER}/${RULESYNC_REPO_NAME}/releases`,
    );
  }

  // Create temporary directory for download
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rulesync-update-"));

  try {
    // Set restrictive permissions on temp directory (Unix only)
    if (os.platform() !== "win32") {
      await fs.promises.chmod(tempDir, 0o700);
    }

    const tempBinaryPath = path.join(tempDir, assetName);

    // Download the binary
    await downloadFile(binaryAsset.browser_download_url, tempBinaryPath);

    // Verify checksum (mandatory)
    const checksumsPath = path.join(tempDir, "SHA256SUMS");
    await downloadFile(checksumAsset.browser_download_url, checksumsPath);

    const checksumsContent = await fs.promises.readFile(checksumsPath, "utf-8");
    const checksums = parseSha256Sums(checksumsContent);
    const expectedChecksum = checksums.get(assetName);

    if (!expectedChecksum) {
      throw new Error(
        `Checksum entry for "${assetName}" not found in SHA256SUMS. Cannot verify download integrity.`,
      );
    }

    const actualChecksum = await calculateSha256(tempBinaryPath);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Checksum verification failed. Expected: ${expectedChecksum}, Got: ${actualChecksum}. The download may be corrupted.`,
      );
    }

    // Resolve symlinks to get the real executable path
    const currentExePath = await fs.promises.realpath(process.execPath);

    // Backup current binary to temp directory (not predictable path)
    const backupPath = path.join(tempDir, "rulesync.backup");
    try {
      await fs.promises.copyFile(currentExePath, backupPath);
    } catch (error) {
      if (isPermissionError(error)) {
        throw new UpdatePermissionError(
          `Permission denied: Cannot read ${currentExePath}. Try running with sudo.`,
        );
      }
      throw error;
    }

    try {
      // Replace with new binary
      await fs.promises.copyFile(tempBinaryPath, currentExePath);

      // Set executable permissions (Unix only)
      if (os.platform() !== "win32") {
        await fs.promises.chmod(currentExePath, 0o755);
      }

      return `Successfully updated from ${currentVersion} to ${updateCheck.latestVersion}`;
    } catch (error) {
      // Restore from backup on failure
      try {
        await fs.promises.copyFile(backupPath, currentExePath);
      } catch {
        // Ignore restore errors
      }
      if (isPermissionError(error)) {
        throw new UpdatePermissionError(
          `Permission denied: Cannot write to ${path.dirname(currentExePath)}. Try running with sudo.`,
        );
      }
      throw error;
    }
  } finally {
    // Cleanup temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if an error is a permission error
 */
function isPermissionError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const record = error as Record<string, unknown>;
    return record["code"] === "EACCES" || record["code"] === "EPERM";
  }
  return false;
}

/**
 * Get upgrade instructions for npm installation
 */
export function getNpmUpgradeInstructions(): string {
  return `This rulesync installation was installed via npm/npx.

To upgrade, run one of the following commands:

  Global installation:
    npm install -g rulesync@latest

  Project dependency:
    npm install rulesync@latest

  Or use npx to always run the latest version:
    npx rulesync@latest --version`;
}

/**
 * Get upgrade instructions for Homebrew installation
 */
export function getHomebrewUpgradeInstructions(): string {
  return `This rulesync installation was installed via Homebrew.

To upgrade, run:
  brew upgrade rulesync`;
}
