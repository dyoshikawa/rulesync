import { gunzipSync } from "node:zlib";

/**
 * Minimal, hardened tar reader for npm package tarballs (EXPERIMENTAL npm
 * transport). Intentionally supports only the subset of the (pax-extended)
 * ustar format that npm-compatible registries produce:
 *
 * - regular files (typeflag "0" / "\0")
 * - directories (typeflag "5") — skipped; directories are created implicitly
 * - pax extended headers (typeflag "x") — only the `path` override is honored
 * - GNU long names (typeflag "L")
 *
 * Everything else (symlinks, hardlinks, devices, FIFOs, ...) is skipped and
 * never materialized. Extraction is bounded by file-count and total-byte caps
 * to prevent decompression bombs, and every entry path is validated against
 * traversal (absolute paths, `..` segments, backslashes).
 */

const BLOCK_SIZE = 512;

/** Maximum number of files extracted from a single package tarball. */
export const MAX_TAR_FILES = 10_000;
/** Maximum total extracted bytes from a single package tarball (100 MB). */
export const MAX_TAR_TOTAL_BYTES = 100 * 1024 * 1024;

export class NpmTarError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NpmTarError";
  }
}

export type TarFileEntry = {
  /**
   * Entry path relative to the package root. The first path component of every
   * entry (conventionally `package/` in npm tarballs, but registries may use a
   * different folder name) is stripped, matching `tar --strip-components=1`.
   */
  relativePath: string;
  content: Buffer;
};

/**
 * Gunzip and extract a npm package tarball into an in-memory file list.
 * Throws {@link NpmTarError} on malformed archives, traversal attempts, or
 * resource-limit violations.
 */
export function extractPackageTarball(params: {
  tarball: Buffer;
  maxFiles?: number;
  maxTotalBytes?: number;
  onSkippedEntry?: (message: string) => void;
}): TarFileEntry[] {
  const { tarball, onSkippedEntry } = params;
  const maxFiles = params.maxFiles ?? MAX_TAR_FILES;
  const maxTotalBytes = params.maxTotalBytes ?? MAX_TAR_TOTAL_BYTES;

  let tar: Buffer;
  try {
    // Cap the decompressed size at the gzip layer as well: the total-byte cap
    // plus generous headroom for tar headers/padding (3 blocks per file).
    tar = gunzipSync(tarball, {
      maxOutputLength: maxTotalBytes + maxFiles * 3 * BLOCK_SIZE + 2 * BLOCK_SIZE,
    });
  } catch (error) {
    throw new NpmTarError("Failed to gunzip package tarball", error);
  }

  return parseTarBuffer({ tar, maxFiles, maxTotalBytes, onSkippedEntry });
}

function parseTarBuffer(params: {
  tar: Buffer;
  maxFiles: number;
  maxTotalBytes: number;
  onSkippedEntry?: (message: string) => void;
}): TarFileEntry[] {
  const { tar, maxFiles, maxTotalBytes, onSkippedEntry } = params;
  const files: TarFileEntry[] = [];
  let totalBytes = 0;
  let offset = 0;
  let pendingLongName: string | undefined;
  let pendingPaxPath: string | undefined;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) {
      break;
    }
    verifyHeaderChecksum(header);

    const size = parseOctalField(header, 124, 12, "size");
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new NpmTarError("Truncated tar archive: entry data extends past end of archive");
    }

    switch (typeflag) {
      case "x": {
        const records = parsePaxRecords(tar.subarray(dataStart, dataEnd));
        if (records.has("size")) {
          // A pax size override means the octal size field is unreliable; a
          // minimal reader cannot stay aligned, so refuse instead of misparsing.
          throw new NpmTarError("Unsupported tar archive: pax size override is not supported");
        }
        pendingPaxPath = records.get("path") ?? pendingPaxPath;
        break;
      }
      case "L": {
        pendingLongName = trimAtFirstNul(tar.toString("utf8", dataStart, dataEnd));
        break;
      }
      case "g": {
        // Global pax header — ignored.
        break;
      }
      case "0":
      case "\0": {
        const rawName = resolveEntryName({ header, pendingLongName, pendingPaxPath });
        pendingLongName = undefined;
        pendingPaxPath = undefined;
        const relativePath = toSafeRelativePath(rawName);
        if (relativePath !== null) {
          if (files.length + 1 > maxFiles) {
            throw new NpmTarError(
              `Package tarball exceeds max file count of ${maxFiles}. Aborting to prevent resource exhaustion.`,
            );
          }
          totalBytes += size;
          if (totalBytes > maxTotalBytes) {
            throw new NpmTarError(
              `Package tarball exceeds max total size of ${maxTotalBytes / 1024 / 1024}MB. Aborting to prevent resource exhaustion.`,
            );
          }
          files.push({
            relativePath,
            content: Buffer.from(tar.subarray(dataStart, dataEnd)),
          });
        }
        break;
      }
      case "5": {
        // Directory — created implicitly when files are written.
        pendingLongName = undefined;
        pendingPaxPath = undefined;
        break;
      }
      default: {
        // Symlinks, hardlinks, devices, FIFOs, ... are never materialized.
        const rawName = resolveEntryName({ header, pendingLongName, pendingPaxPath });
        pendingLongName = undefined;
        pendingPaxPath = undefined;
        onSkippedEntry?.(
          `Skipping unsupported tar entry type "${typeflag}" for "${rawName}" (only regular files are extracted).`,
        );
        break;
      }
    }

    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return files;
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

/** Cut a string at its first NUL character (tar fields are NUL-terminated). */
function trimAtFirstNul(value: string): string {
  const nulIndex = value.indexOf("\0");
  return nulIndex === -1 ? value : value.substring(0, nulIndex);
}

function parseOctalField(block: Buffer, offset: number, length: number, field: string): number {
  const first = block[offset] ?? 0;
  if ((first & 0x80) !== 0) {
    throw new NpmTarError(`Unsupported tar archive: base-256 ${field} field is not supported`);
  }
  const raw = block.toString("latin1", offset, offset + length);
  const text = trimAtFirstNul(raw).trim();
  if (text === "") {
    return 0;
  }
  if (!/^[0-7]+$/.test(text)) {
    throw new NpmTarError(`Invalid tar header: malformed octal ${field} field`);
  }
  return Number.parseInt(text, 8);
}

/**
 * Verify the ustar header checksum: the unsigned byte sum of the 512-byte
 * header with the checksum field itself treated as ASCII spaces.
 */
function verifyHeaderChecksum(header: Buffer): void {
  const stored = parseOctalField(header, 148, 8, "checksum");
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  }
  if (sum !== stored) {
    throw new NpmTarError("Invalid tar header: checksum mismatch");
  }
}

function readCString(block: Buffer, offset: number, length: number): string {
  const end = block.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return block.toString("utf8", offset, stop);
}

function resolveEntryName(params: {
  header: Buffer;
  pendingLongName: string | undefined;
  pendingPaxPath: string | undefined;
}): string {
  const { header, pendingLongName, pendingPaxPath } = params;
  if (pendingPaxPath !== undefined) {
    return pendingPaxPath;
  }
  if (pendingLongName !== undefined) {
    return pendingLongName;
  }
  const name = readCString(header, 0, 100);
  const magic = header.toString("latin1", 257, 262);
  const prefix = magic === "ustar" ? readCString(header, 345, 155) : "";
  return prefix.length > 0 ? `${prefix}/${name}` : name;
}

/**
 * Parse pax extended header records of the form `<len> <key>=<value>\n`,
 * where `<len>` is the decimal length of the whole record.
 */
function parsePaxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    if (data[offset] === 0) {
      break; // trailing NUL padding
    }
    const spaceIndex = data.indexOf(0x20, offset);
    if (spaceIndex === -1) {
      throw new NpmTarError("Invalid pax header: missing length delimiter");
    }
    const recordLength = Number.parseInt(data.toString("utf8", offset, spaceIndex), 10);
    if (
      !Number.isInteger(recordLength) ||
      recordLength <= 0 ||
      offset + recordLength > data.length
    ) {
      throw new NpmTarError("Invalid pax header: malformed record length");
    }
    // Record content excludes the length prefix, the space, and the trailing newline.
    const record = data.toString("utf8", spaceIndex + 1, offset + recordLength - 1);
    const equalsIndex = record.indexOf("=");
    if (equalsIndex !== -1) {
      records.set(record.slice(0, equalsIndex), record.slice(equalsIndex + 1));
    }
    offset += recordLength;
  }
  return records;
}

/**
 * Validate a tar entry path and convert it to a package-root-relative path
 * with the first component stripped. Returns null for entries that resolve to
 * the package root itself (e.g. the `package/` folder entry). Throws on
 * traversal attempts.
 */
function toSafeRelativePath(rawPath: string): string | null {
  if (rawPath.includes("\0")) {
    throw new NpmTarError(`Unsafe tar entry path (NUL byte): "${rawPath}"`);
  }
  if (rawPath.includes("\\")) {
    throw new NpmTarError(`Unsafe tar entry path (backslash): "${rawPath}"`);
  }
  if (rawPath.startsWith("/")) {
    throw new NpmTarError(`Unsafe tar entry path (absolute): "${rawPath}"`);
  }
  const segments = rawPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new NpmTarError(`Unsafe tar entry path (".." segment): "${rawPath}"`);
  }
  // Strip the tarball's single root folder (conventionally `package/`).
  segments.shift();
  if (segments.length === 0) {
    return null;
  }
  return segments.join("/");
}
