import { createHash } from "node:crypto";

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
