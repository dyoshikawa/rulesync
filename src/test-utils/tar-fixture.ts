import { gzipSync } from "node:zlib";

/**
 * Programmatic tar/tgz fixture builder for npm-transport tests. Builds ustar
 * archives with plain Buffer writes — no tar dependency — so tests can craft
 * both well-formed npm package tarballs and malicious archives (path
 * traversal, symlinks, ...).
 */

const BLOCK_SIZE = 512;

export type TarFixtureEntry = {
  name: string;
  /** File content. Ignored for non-file typeflags. */
  content?: string | Buffer;
  /** ustar typeflag. Defaults to "0" (regular file). */
  typeflag?: string;
  /** Value for the linkname field (symlinks/hardlinks). */
  linkname?: string;
  /** Skip checksum computation to craft a corrupt header. */
  corruptChecksum?: boolean;
};

export function buildTarHeader(params: {
  name: string;
  size: number;
  typeflag: string;
  linkname?: string;
  corruptChecksum?: boolean;
}): Buffer {
  const { name, size, typeflag, linkname, corruptChecksum } = params;
  const header = Buffer.alloc(BLOCK_SIZE);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100); // mode
  header.write("0000000\0", 108); // uid
  header.write("0000000\0", 116); // gid
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124); // size
  header.write("00000000000\0", 136); // mtime
  header.write(typeflag, 156);
  if (linkname) {
    header.write(linkname, 157, 100, "utf8");
  }
  header.write("ustar\0", 257); // magic
  header.write("00", 263); // version

  // Checksum: unsigned sum with the checksum field treated as spaces.
  header.fill(0x20, 148, 156);
  if (!corruptChecksum) {
    let sum = 0;
    for (const byte of header) {
      sum += byte;
    }
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  }
  return header;
}

function padToBlock(content: Buffer): Buffer {
  const remainder = content.length % BLOCK_SIZE;
  if (remainder === 0) {
    return content;
  }
  return Buffer.concat([content, Buffer.alloc(BLOCK_SIZE - remainder)]);
}

/** Build an uncompressed tar archive from the given entries. */
export function buildTar(entries: TarFixtureEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const typeflag = entry.typeflag ?? "0";
    const content =
      entry.content === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(entry.content)
          ? entry.content
          : Buffer.from(entry.content, "utf8");
    blocks.push(
      buildTarHeader({
        name: entry.name,
        size: content.length,
        typeflag,
        linkname: entry.linkname,
        corruptChecksum: entry.corruptChecksum,
      }),
    );
    if (content.length > 0) {
      blocks.push(padToBlock(content));
    }
  }
  // End-of-archive marker: two zero blocks.
  blocks.push(Buffer.alloc(2 * BLOCK_SIZE));
  return Buffer.concat(blocks);
}

/** Build a gzipped tar archive (the npm package tarball format). */
export function buildTarball(entries: TarFixtureEntry[]): Buffer {
  return gzipSync(buildTar(entries));
}

/** Build a pax extended header entry (typeflag "x") with the given records. */
export function buildPaxEntry(records: Record<string, string>): TarFixtureEntry {
  let content = "";
  for (const [key, value] of Object.entries(records)) {
    const body = ` ${key}=${value}\n`;
    // Record length is decimal and includes its own digits.
    let length = body.length + 1;
    while (`${length}${body}`.length !== length) {
      length = `${length}${body}`.length;
    }
    content += `${length}${body}`;
  }
  return { name: "PaxHeader/entry", content, typeflag: "x" };
}
