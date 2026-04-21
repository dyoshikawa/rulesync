import { join } from "node:path";

import { dump, load } from "js-yaml";
import { optional, z } from "zod/mini";

import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";

export const APM_MANIFEST_FILE_NAME = "apm.yml";

/**
 * Parsed representation of a single APM `dependencies.apm` entry after
 * normalization. Every accepted input form (string shorthand, object form,
 * HTTPS URL) lands here.
 */
export type ApmDependency = {
  /** Canonical git URL. Always an HTTPS URL for the first iteration. */
  gitUrl: string;
  /** GitHub owner (extracted for use with the REST client). */
  owner: string;
  /** GitHub repo. */
  repo: string;
  /**
   * Optional ref (tag, branch, or commit SHA). Absent means "resolve against
   * the repository's default branch".
   */
  ref?: string;
  /**
   * Optional virtual sub-directory within the repository. When present the
   * install layout is rooted at this path.
   */
  path?: string;
  /**
   * Optional alias used to override the local install directory name.
   */
  alias?: string;
};

const ApmObjectDependencySchema = z.looseObject({
  git: optional(z.string()),
  source: optional(z.string()),
  path: optional(z.string()),
  ref: optional(z.string()),
  alias: optional(z.string()),
});

const ApmDependencyInputSchema = z.union([z.string(), ApmObjectDependencySchema]);

const ApmManifestSchema = z.looseObject({
  name: optional(z.string()),
  version: optional(z.string()),
  dependencies: optional(
    z.looseObject({
      apm: optional(z.array(ApmDependencyInputSchema)),
    }),
  ),
});

export type ApmManifest = {
  name?: string;
  version?: string;
  dependencies: ApmDependency[];
};

/**
 * Return the absolute path to the project's `apm.yml`.
 */
export function getApmManifestPath(baseDir: string): string {
  return join(baseDir, APM_MANIFEST_FILE_NAME);
}

/**
 * True if `apm.yml` exists at the given base directory.
 */
export async function apmManifestExists(baseDir: string): Promise<boolean> {
  return fileExists(getApmManifestPath(baseDir));
}

/**
 * Parse `apm.yml` content. Throws with a descriptive error when parsing
 * or any dependency entry fails normalization.
 */
export function parseApmManifest(content: string): ApmManifest {
  const loaded = load(content);
  if (loaded === undefined || loaded === null) {
    return { dependencies: [] };
  }
  const parsed = ApmManifestSchema.safeParse(loaded);
  if (!parsed.success) {
    throw new Error(`Invalid apm.yml: ${parsed.error.message}`);
  }
  const raw = parsed.data;
  const rawDeps = raw.dependencies?.apm ?? [];
  const dependencies: ApmDependency[] = rawDeps.map((entry, index) =>
    normalizeDependency(entry, index),
  );
  return {
    name: raw.name,
    version: raw.version,
    dependencies,
  };
}

/**
 * Read and parse `apm.yml` from disk.
 */
export async function readApmManifest(baseDir: string): Promise<ApmManifest> {
  const path = getApmManifestPath(baseDir);
  const content = await readFileContent(path);
  return parseApmManifest(content);
}

/**
 * Write an `apm.yml` back to disk. Only used by tests today — the install
 * command itself does not mutate the manifest.
 */
export async function writeApmManifest(params: {
  baseDir: string;
  manifest: { name?: string; version?: string; dependencies?: unknown[] };
}): Promise<void> {
  const path = getApmManifestPath(params.baseDir);
  const content = dump(params.manifest, { lineWidth: -1 });
  await writeFileContent(path, content);
}

function normalizeDependency(
  entry: string | z.infer<typeof ApmObjectDependencySchema>,
  index: number,
): ApmDependency {
  if (typeof entry === "string") {
    return normalizeStringDependency(entry, index);
  }
  const gitUrl = entry.git ?? entry.source;
  if (!gitUrl) {
    throw new Error(
      `apm.yml dependency #${index + 1}: object form requires a "git" field. Received: ${JSON.stringify(entry)}.`,
    );
  }
  const parsedUrl = parseHttpsGitHubUrl(gitUrl);
  if (!parsedUrl) {
    throw new Error(
      `apm.yml dependency #${index + 1}: unsupported git URL "${gitUrl}". Only HTTPS GitHub URLs (https://github.com/owner/repo[.git]) are supported in this version. SSH, GitLab, Bitbucket, and other hosts are not yet supported.`,
    );
  }
  if (entry.path !== undefined) {
    validateSubPath(entry.path, index);
  }
  return {
    gitUrl: parsedUrl.gitUrl,
    owner: parsedUrl.owner,
    repo: parsedUrl.repo,
    ref: entry.ref,
    path: entry.path,
    alias: entry.alias,
  };
}

/**
 * Reject `dep.path` values that could escape the repository root or be
 * interpreted as an absolute path on the remote tree.
 */
function validateSubPath(subPath: string, index: number): void {
  if (subPath === "" || subPath.startsWith("/") || subPath.startsWith("\\")) {
    throw new Error(
      `apm.yml dependency #${index + 1}: "path" must be a non-empty relative path without a leading slash. Received: ${JSON.stringify(subPath)}.`,
    );
  }
  const segments = subPath.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `apm.yml dependency #${index + 1}: "path" must not contain ".." segments. Received: ${JSON.stringify(subPath)}.`,
    );
  }
}

function normalizeStringDependency(entry: string, index: number): ApmDependency {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error(`apm.yml dependency #${index + 1}: entry must be a non-empty string.`);
  }
  rejectUnsupportedShorthand(trimmed, index);

  if (trimmed.startsWith("https://")) {
    const [urlPart, refPart] = splitOnFirst(trimmed, "#");
    const parsed = parseHttpsGitHubUrl(urlPart);
    if (!parsed) {
      throw new Error(
        `apm.yml dependency #${index + 1}: unsupported URL "${urlPart}". Only HTTPS GitHub URLs (https://github.com/owner/repo[.git]) are supported in this version.`,
      );
    }
    return {
      gitUrl: parsed.gitUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      ref: refPart || undefined,
    };
  }

  const [ownerRepo, refPart] = splitOnFirst(trimmed, "#");
  const slashIndex = ownerRepo.indexOf("/");
  if (slashIndex === -1 || slashIndex === 0 || slashIndex === ownerRepo.length - 1) {
    throw new Error(
      `apm.yml dependency #${index + 1}: shorthand "${entry}" must be in the form "owner/repo[#ref]".`,
    );
  }
  if (ownerRepo.includes("/", slashIndex + 1)) {
    throw new Error(
      `apm.yml dependency #${index + 1}: FQDN shorthand or sub-path shorthand ("${entry}") is not yet supported. Use the object form with an explicit "git" URL.`,
    );
  }
  // Canonicalize owner/repo to lower-case for case-insensitive matching.
  const owner = ownerRepo.substring(0, slashIndex).toLowerCase();
  const repo = ownerRepo.substring(slashIndex + 1).toLowerCase();
  return {
    gitUrl: `https://github.com/${owner}/${repo}.git`,
    owner,
    repo,
    ref: refPart || undefined,
  };
}

function rejectUnsupportedShorthand(entry: string, index: number): void {
  if (entry.startsWith("./") || entry.startsWith("../") || entry.startsWith("/")) {
    throw new Error(
      `apm.yml dependency #${index + 1}: local path dependencies ("${entry}") are not yet supported by rulesync.`,
    );
  }
  if (entry.startsWith("git@") || entry.startsWith("ssh://")) {
    throw new Error(
      `apm.yml dependency #${index + 1}: SSH URL dependencies ("${entry}") are not yet supported. Use an HTTPS GitHub URL.`,
    );
  }
  if (entry.includes("@marketplace")) {
    throw new Error(
      `apm.yml dependency #${index + 1}: APM marketplace dependencies ("${entry}") are not yet supported.`,
    );
  }
}

function parseHttpsGitHubUrl(url: string): { gitUrl: string; owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const rawOwner = segments[0];
  const rawRepo = segments[1];
  if (!rawOwner || !rawRepo) {
    return null;
  }
  // GitHub treats owner/repo names case-insensitively for routing. Canonicalize
  // to lower-case so that lockfile comparisons and frozen-mode checks are not
  // tripped up by a user re-casing their manifest.
  const owner = rawOwner.toLowerCase();
  const repo = rawRepo.replace(/\.git$/, "").toLowerCase();
  return {
    gitUrl: `https://github.com/${owner}/${repo}.git`,
    owner,
    repo,
  };
}

function splitOnFirst(input: string, separator: string): [string, string | undefined] {
  const idx = input.indexOf(separator);
  if (idx === -1) return [input, undefined];
  return [input.substring(0, idx), input.substring(idx + 1)];
}
