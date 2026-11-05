import { createHash } from "node:crypto";

/**
 * Shape of content_hash values that rulesync writes (the output of
 * `computeInstallContentHash`), shared by the apm and gh install modes. Used
 * by `--frozen` integrity checks to decide whether a prior hash is comparable:
 * any value not matching this regex (e.g. written by the upstream `apm` CLI)
 * is skipped rather than throwing so that cross-tool interop works.
 */
export const RULESYNC_CONTENT_HASH_REGEX = /^sha256:[0-9a-f]{64}$/;

/**
 * SHA-256 over a canonical, order-independent representation of the deployed
 * files, shared by the apm and gh install modes. Written into the lockfile's
 * content hash so that `--frozen` installs can refuse to trust tampered output.
 */
export function computeInstallContentHash(
  files: ReadonlyArray<{ path: string; content: string }>,
): string {
  const hash = createHash("sha256");
  for (const { path, content } of files) {
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
