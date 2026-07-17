import { createHash } from "node:crypto";

import type { Logger } from "../utils/logger.js";
import { findControlCharacter } from "../utils/validation.js";

/**
 * Minimal npm-compatible registry client for the EXPERIMENTAL `npm` transport.
 * Works against any registry implementing the npm registry API (npmjs.org,
 * JFrog Artifactory, Sonatype Nexus, Verdaccio, ...). Intentionally avoids
 * `.npmrc` parsing: authentication uses a bearer token from an environment
 * variable (`NPM_TOKEN` by default, or a per-source `tokenEnv`).
 */

export const DEFAULT_NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const DEFAULT_NPM_TOKEN_ENV = "NPM_TOKEN";

/** Abbreviated packument media type (install metadata only). */
const PACKUMENT_ACCEPT_HEADER = "application/vnd.npm.install-v1+json";

/** Timeout for registry HTTP requests (60 seconds). */
const NPM_FETCH_TIMEOUT_MS = 60_000;

/** Maximum accepted tarball size (compressed), aligned with the extraction cap. */
const MAX_TARBALL_SIZE = 100 * 1024 * 1024;

/**
 * npm package name rules (scoped or unscoped, URL-safe characters only).
 * This also guards against URL path injection into registry requests.
 */
const NPM_PACKAGE_NAME_REGEX = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const MAX_NPM_PACKAGE_NAME_LENGTH = 214;

const INTEGRITY_ALGORITHM_PREFERENCE = ["sha512", "sha384", "sha256", "sha1"] as const;
type IntegrityAlgorithm = (typeof INTEGRITY_ALGORITHM_PREFERENCE)[number];

export class NpmClientError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, options?: { statusCode?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "NpmClientError";
    this.statusCode = options?.statusCode;
  }
}

export type NpmDist = {
  tarball: string;
  integrity?: string;
  shasum?: string;
};

export type NpmPackument = {
  name?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { dist?: NpmDist }>;
};

export function validateNpmPackageName(name: string): void {
  if (name.length > MAX_NPM_PACKAGE_NAME_LENGTH || !NPM_PACKAGE_NAME_REGEX.test(name)) {
    throw new NpmClientError(
      `Invalid npm package name: "${name}". Expected "name" or "@scope/name".`,
    );
  }
}

export function validateNpmRegistryUrl(url: string, options?: { logger?: Logger }): void {
  const ctrl = findControlCharacter(url);
  if (ctrl) {
    throw new NpmClientError(
      `Registry URL contains control character ${ctrl.hex} at position ${ctrl.position}`,
    );
  }
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new NpmClientError(`Unsupported registry URL: "${url}". Use https:// (or http://).`);
  }
  if (url.startsWith("http://")) {
    options?.logger?.warn(
      `Registry URL "${url}" uses an unencrypted protocol. Consider using https:// instead.`,
    );
  }
}

/**
 * Resolve the registry token from the environment. When `tokenEnv` is set it
 * must name an existing environment variable; otherwise `NPM_TOKEN` is used
 * when present. The token value itself is never logged.
 */
export function resolveNpmToken(params: { tokenEnv?: string }): string | undefined {
  const { tokenEnv } = params;
  if (tokenEnv !== undefined) {
    const value = process.env[tokenEnv];
    if (value === undefined || value === "") {
      throw new NpmClientError(
        `Environment variable "${tokenEnv}" (from tokenEnv) is not set. Export it or remove the tokenEnv field.`,
      );
    }
    return value;
  }
  const fallback = process.env[DEFAULT_NPM_TOKEN_ENV];
  return fallback === undefined || fallback === "" ? undefined : fallback;
}

/** Build the packument URL for a (possibly scoped) package on a registry. */
export function buildPackumentUrl(params: { registryUrl: string; packageName: string }): string {
  const { registryUrl, packageName } = params;
  const base = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;
  // Scoped package names keep the "@" but encode the slash, per the npm registry API.
  const encodedName = packageName.replace("/", "%2F");
  return new URL(encodedName, base).toString();
}

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(NPM_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new NpmClientError(`Network error while requesting ${url}`, { cause: error });
  }
}

/**
 * Fetch the (abbreviated) packument for a package from a registry.
 */
export async function fetchPackument(params: {
  registryUrl: string;
  packageName: string;
  token?: string;
}): Promise<NpmPackument> {
  const { registryUrl, packageName, token } = params;
  validateNpmPackageName(packageName);
  const url = buildPackumentUrl({ registryUrl, packageName });

  const headers: Record<string, string> = { Accept: PACKUMENT_ACCEPT_HEADER };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(url, headers);
  if (!response.ok) {
    throw new NpmClientError(
      `Failed to fetch package metadata for "${packageName}" from ${registryUrl}: HTTP ${response.status}`,
      { statusCode: response.status },
    );
  }
  try {
    return (await response.json()) as NpmPackument;
  } catch (error) {
    throw new NpmClientError(
      `Failed to parse package metadata for "${packageName}" from ${registryUrl}`,
      { cause: error },
    );
  }
}

/**
 * Resolve a requested version or dist-tag against a packument. Only exact
 * versions and dist-tags are supported — semver ranges are intentionally out
 * of scope (no semver dependency).
 */
export function resolvePackumentVersion(params: {
  packument: NpmPackument;
  packageName: string;
  requested: string;
}): string {
  const { packument, packageName, requested } = params;
  const versions = packument.versions ?? {};
  if (Object.prototype.hasOwnProperty.call(versions, requested)) {
    return requested;
  }
  const distTags = packument["dist-tags"] ?? {};
  const tagged = Object.prototype.hasOwnProperty.call(distTags, requested)
    ? distTags[requested]
    : undefined;
  if (tagged !== undefined && Object.prototype.hasOwnProperty.call(versions, tagged)) {
    return tagged;
  }
  throw new NpmClientError(
    `Could not resolve "${packageName}@${requested}": not an exact published version or dist-tag. Note: semver ranges are not supported by the npm transport.`,
  );
}

/** Get the dist metadata (tarball URL, integrity) for a resolved version. */
export function getPackumentVersionDist(params: {
  packument: NpmPackument;
  packageName: string;
  version: string;
}): NpmDist {
  const { packument, packageName, version } = params;
  const versions = packument.versions ?? {};
  const entry = Object.prototype.hasOwnProperty.call(versions, version)
    ? versions[version]
    : undefined;
  const dist = entry?.dist;
  if (!dist?.tarball) {
    throw new NpmClientError(
      `Registry metadata for "${packageName}@${version}" is missing the dist.tarball URL.`,
    );
  }
  return dist;
}

/**
 * Download a package tarball. The Authorization header is only attached when
 * the tarball is hosted on the same host as the registry, so the token never
 * leaks to third-party CDNs.
 */
export async function fetchTarball(params: {
  tarballUrl: string;
  registryUrl: string;
  token?: string;
}): Promise<Buffer> {
  const { tarballUrl, registryUrl, token } = params;
  if (!tarballUrl.startsWith("https://") && !tarballUrl.startsWith("http://")) {
    throw new NpmClientError(
      `Unsupported tarball URL: "${tarballUrl}". Use https:// (or http://).`,
    );
  }

  const headers: Record<string, string> = {};
  if (token && isSameHost(tarballUrl, registryUrl)) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(tarballUrl, headers);
  if (!response.ok) {
    throw new NpmClientError(`Failed to download tarball ${tarballUrl}: HTTP ${response.status}`, {
      statusCode: response.status,
    });
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_TARBALL_SIZE) {
    throw new NpmClientError(
      `Tarball ${tarballUrl} exceeds max size of ${MAX_TARBALL_SIZE / 1024 / 1024}MB.`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_TARBALL_SIZE) {
    throw new NpmClientError(
      `Tarball ${tarballUrl} exceeds max size of ${MAX_TARBALL_SIZE / 1024 / 1024}MB.`,
    );
  }
  return Buffer.from(arrayBuffer);
}

function isSameHost(urlA: string, urlB: string): boolean {
  try {
    return new URL(urlA).host === new URL(urlB).host;
  } catch {
    return false;
  }
}

/**
 * Convert a hex sha1 shasum to the SRI form used by `verifyTarballIntegrity`.
 */
export function shasumToSri(shasum: string): string {
  return `sha1-${Buffer.from(shasum, "hex").toString("base64")}`;
}

/**
 * Verify a downloaded tarball against registry integrity metadata.
 * Prefers the strongest supported algorithm in the SRI `integrity` string and
 * falls back to the legacy sha1 `shasum`. Logs a warning when the registry
 * provides no integrity metadata at all.
 */
export function verifyTarballIntegrity(params: {
  tarball: Buffer;
  integrity?: string;
  shasum?: string;
  context: string;
  logger?: Logger;
}): void {
  const { tarball, integrity, shasum, context, logger } = params;

  const sri = pickStrongestSriEntry(integrity);
  if (sri) {
    const actual = createHash(sri.algorithm).update(tarball).digest("base64");
    if (actual !== sri.digest) {
      throw new NpmClientError(
        `Integrity verification failed for ${context}: expected ${sri.algorithm}-${sri.digest}, got ${sri.algorithm}-${actual}. The tarball may have been tampered with.`,
      );
    }
    return;
  }

  if (shasum) {
    const actual = createHash("sha1").update(tarball).digest("hex");
    if (actual !== shasum.toLowerCase()) {
      throw new NpmClientError(
        `Integrity verification failed for ${context}: expected sha1 ${shasum}, got ${actual}. The tarball may have been tampered with.`,
      );
    }
    return;
  }

  logger?.warn(`No integrity metadata available for ${context}; skipping tarball verification.`);
}

function pickStrongestSriEntry(
  integrity: string | undefined,
): { algorithm: IntegrityAlgorithm; digest: string } | undefined {
  if (!integrity) {
    return undefined;
  }
  const entries = integrity
    .split(/\s+/)
    .map((entry) => {
      const separatorIndex = entry.indexOf("-");
      if (separatorIndex === -1) return undefined;
      const algorithm = entry.slice(0, separatorIndex);
      const digest = entry.slice(separatorIndex + 1);
      const known = INTEGRITY_ALGORITHM_PREFERENCE.find((a) => a === algorithm);
      if (!known || digest.length === 0) return undefined;
      return { algorithm: known, digest };
    })
    .filter((entry): entry is { algorithm: IntegrityAlgorithm; digest: string } => Boolean(entry));

  for (const algorithm of INTEGRITY_ALGORITHM_PREFERENCE) {
    const match = entries.find((entry) => entry.algorithm === algorithm);
    if (match) {
      return match;
    }
  }
  return undefined;
}

/**
 * Log contextual hints for NpmClientError to help users troubleshoot
 * authentication problems without ever logging the token itself.
 */
export function logNpmAuthHints(params: { error: NpmClientError; logger: Logger }): void {
  const { error, logger } = params;
  if (error.statusCode === 401 || error.statusCode === 403) {
    logger.info(
      "Hint: The registry rejected the request. Set NPM_TOKEN (or the per-source tokenEnv variable) to a token with read access. Note: .npmrc files are not read by the npm transport.",
    );
  } else if (error.statusCode === 404) {
    logger.info(
      "Hint: Package not found. Check the package name and the registry URL. Some registries also return 404 for unauthorized requests.",
    );
  }
}
