import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { MAX_FILE_SIZE } from "../constants/rulesync-paths.js";
import {
  createTempDirectory,
  directoryExists,
  getFileSize,
  isSymlink,
  listDirectoryFiles,
  readFileContent,
  removeTempDirectory,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

const ALLOWED_URL_SCHEMES =
  /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/\/|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9_.+/~-]+)/;

const INSECURE_URL_SCHEMES = /^(git:\/\/|http:\/\/)/;

export class GitClientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "GitClientError";
  }
}

export function validateGitUrl(url: string): void {
  if (!ALLOWED_URL_SCHEMES.test(url)) {
    throw new GitClientError(
      `Unsupported or unsafe git URL: "${url}". Use https, ssh, git, or file schemes.`,
    );
  }
  if (INSECURE_URL_SCHEMES.test(url)) {
    logger.warn(
      `URL "${url}" uses an unencrypted protocol. Consider using https:// or ssh:// instead.`,
    );
  }
}

let gitChecked = false;

export async function checkGitAvailable(): Promise<void> {
  if (gitChecked) return;
  try {
    await execFileAsync("git", ["--version"]);
    gitChecked = true;
  } catch {
    throw new GitClientError("git is not installed or not found in PATH");
  }
}

/** Reset the cached git availability check (for testing). */
export function resetGitCheck(): void {
  gitChecked = false;
}

export async function resolveDefaultRef(url: string): Promise<{ ref: string; sha: string }> {
  validateGitUrl(url);
  await checkGitAvailable();
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "--symref", "--", url, "HEAD"]);
    const ref = stdout.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
    const sha = stdout.match(/^([0-9a-f]{40})\tHEAD$/m)?.[1];
    if (!ref || !sha) throw new GitClientError(`Could not parse default branch from: ${url}`);
    return { ref, sha };
  } catch (error) {
    if (error instanceof GitClientError) throw error;
    throw new GitClientError(`Failed to resolve default ref for ${url}`, error);
  }
}

export async function resolveRefToSha(url: string, ref: string): Promise<string> {
  validateGitUrl(url);
  await checkGitAvailable();
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "--", url, ref]);
    const sha = stdout.match(/^([0-9a-f]{40})\t/m)?.[1];
    if (!sha) throw new GitClientError(`Ref "${ref}" not found in ${url}`);
    return sha;
  } catch (error) {
    if (error instanceof GitClientError) throw error;
    throw new GitClientError(`Failed to resolve ref "${ref}" for ${url}`, error);
  }
}

/**
 * Clone a repo at the given ref and return all files under skillsPath.
 * The `ref` must be a branch or tag name (not a commit SHA) because
 * `git clone --branch` does not accept raw SHAs.
 */
export async function fetchSkillFiles(params: {
  url: string;
  ref: string;
  skillsPath: string;
}): Promise<Array<{ relativePath: string; content: string; size: number }>> {
  const { url, ref, skillsPath } = params;
  validateGitUrl(url);
  await checkGitAvailable();
  const tmpDir = await createTempDirectory("rulesync-git-");
  try {
    await execFileAsync("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      ref,
      "--no-checkout",
      "--filter=blob:none",
      "--",
      url,
      tmpDir,
    ]);
    await execFileAsync("git", ["-C", tmpDir, "sparse-checkout", "set", "--", skillsPath]);
    await execFileAsync("git", ["-C", tmpDir, "checkout"]);
    const skillsDir = join(tmpDir, skillsPath);
    if (!(await directoryExists(skillsDir))) return [];
    return await walkDirectory(skillsDir, skillsDir);
  } catch (error) {
    if (error instanceof GitClientError) throw error;
    throw new GitClientError(`Failed to fetch skill files from ${url}`, error);
  } finally {
    await removeTempDirectory(tmpDir);
  }
}

const MAX_WALK_DEPTH = 20;

async function walkDirectory(
  dir: string,
  baseDir: string,
  depth: number = 0,
): Promise<Array<{ relativePath: string; content: string; size: number }>> {
  if (depth > MAX_WALK_DEPTH) {
    throw new GitClientError(
      `Directory tree exceeds max depth of ${MAX_WALK_DEPTH}: "${dir}". Aborting to prevent resource exhaustion.`,
    );
  }
  const results: Array<{ relativePath: string; content: string; size: number }> = [];
  for (const name of await listDirectoryFiles(dir)) {
    if (name === ".git") continue;
    const fullPath = join(dir, name);
    if (await isSymlink(fullPath)) {
      logger.warn(`Skipping symlink "${fullPath}".`);
      continue;
    }
    if (await directoryExists(fullPath)) {
      results.push(...(await walkDirectory(fullPath, baseDir, depth + 1)));
    } else {
      const size = await getFileSize(fullPath);
      if (size > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping file "${fullPath}" (${(size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
        );
        continue;
      }
      const content = await readFileContent(fullPath);
      results.push({ relativePath: fullPath.substring(baseDir.length + 1), content, size });
    }
  }
  return results;
}
