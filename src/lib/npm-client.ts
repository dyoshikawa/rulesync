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
  // Validate here too so the URL can never carry extra path segments, even if a
  // caller skips the fetch-level validation.
  validateNpmPackageName(packageName);
  const base = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;
  // Scoped package names keep the "@" but encode the slash, per the npm registry API.
  const encodedName = packageName.replaceAll("/", "%2F");
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
 * the tarball is hosted on the same origin (scheme + host) as the registry,
 * so the token never leaks to third-party CDNs or plaintext downgrades.
 */
export async function fetchTarball(params: {
  tarballUrl: string;
  registryUrl: string;
  token?: string;
  /** Maximum accepted tarball size in bytes. Overridable for tests only. */
  maxSize?: number;
}): Promise<Buffer> {
  const { tarballUrl, registryUrl, token } = params;
  const maxSize = params.maxSize ?? MAX_TARBALL_SIZE;
  if (!tarballUrl.startsWith("https://") && !tarballUrl.startsWith("http://")) {
    throw new NpmClientError(
      `Unsupported tarball URL: "${tarballUrl}". Use https:// (or http://).`,
    );
  }

  const headers: Record<string, string> = {};
  if (token && isSameOrigin(tarballUrl, registryUrl)) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(tarballUrl, headers);
  if (!response.ok) {
    throw new NpmClientError(`Failed to download tarball ${tarballUrl}: HTTP ${response.status}`, {
      statusCode: response.status,
    });
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    throw new NpmClientError(oversizedTarballMessage(tarballUrl, maxSize));
  }
  return await readBodyWithLimit({ response, tarballUrl, maxSize });
}

function oversizedTarballMessage(tarballUrl: string, maxSize: number): string {
  return `Tarball ${tarballUrl} exceeds max size of ${maxSize / 1024 / 1024}MB.`;
}

/**
 * Read a response body incrementally, aborting as soon as the size cap is
 * exceeded. content-length can be absent or forged, so the streaming check is
 * the actual enforcement of the cap.
 */
async function readBodyWithLimit(params: {
  response: Response;
  tarballUrl: string;
  maxSize: number;
}): Promise<Buffer> {
  const { response, tarballUrl, maxSize } = params;
  const reader = response.body?.getReader();
  if (!reader) {
    // Responses without a body stream (e.g. some test doubles): buffer
    // with a post-hoc check.
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) {
      throw new NpmClientError(oversizedTarballMessage(tarballUrl, maxSize));
    }
    return Buffer.from(arrayBuffer);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxSize) {
      await reader.cancel();
      throw new NpmClientError(oversizedTarballMessage(tarballUrl, maxSize));
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function isSameOrigin(urlA: string, urlB: string): boolean {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

/**
 * Convert a hex sha1 shasum to the SRI form used by `verifyTarballIntegrity`.
 * Rejects malformed shasum values so a broken value is never recorded in the
 * lockfile as a seemingly valid SRI string.
 */
export function shasumToSri(shasum: string): string {
  if (!/^[0-9a-f]{40}$/i.test(shasum)) {
    throw new NpmClientError(`Malformed sha1 shasum in registry metadata: "${shasum}"`);
  }
  return `sha1-${Buffer.from(shasum, "hex").toString("base64")}`;
}

/**
 * Verify a downloaded tarball against registry integrity metadata.
 * Prefers the strongest supported algorithm in the SRI `integrity` string and
 * falls back to the legacy sha1 `shasum`. An `integrity` string that is
 * present but cannot be parsed fails closed; a warning is only logged when
 * the registry provides no integrity metadata at all.
 */
export function verifyTarballIntegrity(params: {
  tarball: Buffer;
  integrity?: string;
  shasum?: string;
  context: string;
  logger?: Logger;
}): void {
  const { tarball, integrity, shasum, context, logger } = params;

  if (integrity !== undefined) {
    const sri = pickStrongestSriEntry(integrity);
    if (!sri) {
      // Fail closed: a present-but-unparseable integrity value must never
      // silently disable verification (e.g. a corrupted lockfile entry).
      throw new NpmClientError(
        `Unsupported or malformed integrity metadata for ${context}. Expected an SRI string with sha512/sha384/sha256/sha1.`,
      );
    }
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
      // Strip SRI options (`sha512-<digest>?opt`) from the digest.
      const digest = entry.slice(separatorIndex + 1).split("?")[0] ?? "";
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
