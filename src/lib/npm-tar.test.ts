import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { buildPaxEntry, buildTar, buildTarball } from "../test-utils/tar-fixture.js";
import { extractPackageTarball, NpmTarError } from "./npm-tar.js";

describe("extractPackageTarball", () => {
  it("extracts regular files and strips the package/ prefix", () => {
    const tarball = buildTarball([
      { name: "package/", typeflag: "5" },
      { name: "package/SKILL.md", content: "# My Skill\n" },
      { name: "package/skills/", typeflag: "5" },
      { name: "package/skills/my-skill/SKILL.md", content: "# Nested\n" },
      { name: "package/skills/my-skill/references/notes.md", content: "notes" },
    ]);

    const entries = extractPackageTarball({ tarball });

    expect(entries).toEqual([
      { relativePath: "SKILL.md", content: Buffer.from("# My Skill\n") },
      { relativePath: "skills/my-skill/SKILL.md", content: Buffer.from("# Nested\n") },
      { relativePath: "skills/my-skill/references/notes.md", content: Buffer.from("notes") },
    ]);
  });

  it("strips a non-package root folder name (Artifactory-style tarballs)", () => {
    const tarball = buildTarball([{ name: "my-pkg-1.0.0/SKILL.md", content: "root" }]);

    const entries = extractPackageTarball({ tarball });

    expect(entries).toEqual([{ relativePath: "SKILL.md", content: Buffer.from("root") }]);
  });

  it("rejects entries with .. path traversal segments", () => {
    const tarball = buildTarball([{ name: "package/../evil", content: "malicious" }]);

    expect(() => extractPackageTarball({ tarball })).toThrow(NpmTarError);
    expect(() => extractPackageTarball({ tarball })).toThrow(/\.\./);
  });

  it("rejects absolute entry paths", () => {
    const tarball = buildTarball([{ name: "/etc/passwd", content: "evil" }]);

    expect(() => extractPackageTarball({ tarball })).toThrow(/absolute/);
  });

  it("rejects entry paths containing backslashes", () => {
    const tarball = buildTarball([{ name: "package/..\\evil", content: "evil" }]);

    expect(() => extractPackageTarball({ tarball })).toThrow(/backslash/);
  });

  it("skips symlinks and hardlinks without materializing them", () => {
    const onSkippedEntry = vi.fn();
    const tarball = buildTarball([
      { name: "package/link", typeflag: "2", linkname: "/etc/passwd" },
      { name: "package/hardlink", typeflag: "1", linkname: "target" },
      { name: "package/SKILL.md", content: "safe" },
    ]);

    const entries = extractPackageTarball({ tarball, onSkippedEntry });

    expect(entries).toEqual([{ relativePath: "SKILL.md", content: Buffer.from("safe") }]);
    expect(onSkippedEntry).toHaveBeenCalledTimes(2);
    expect(onSkippedEntry.mock.calls[0]?.[0]).toContain('type "2"');
  });

  it("honors pax extended header path overrides", () => {
    const tarball = buildTarball([
      buildPaxEntry({ path: "package/renamed-via-pax.md" }),
      { name: "package/original.md", content: "pax content" },
    ]);

    const entries = extractPackageTarball({ tarball });

    expect(entries).toEqual([
      { relativePath: "renamed-via-pax.md", content: Buffer.from("pax content") },
    ]);
  });

  it("rejects pax path overrides that traverse outside the package", () => {
    const tarball = buildTarball([
      buildPaxEntry({ path: "package/../../evil" }),
      { name: "package/original.md", content: "evil" },
    ]);

    expect(() => extractPackageTarball({ tarball })).toThrow(/\.\./);
  });

  it("honors GNU long name entries", () => {
    const longName = `package/${"a".repeat(120)}/SKILL.md`;
    const tarball = buildTarball([
      { name: "././@LongLink", content: `${longName}\0`, typeflag: "L" },
      { name: "package/truncated", content: "long name content" },
    ]);

    const entries = extractPackageTarball({ tarball });

    expect(entries).toEqual([
      { relativePath: `${"a".repeat(120)}/SKILL.md`, content: Buffer.from("long name content") },
    ]);
  });

  it("does not leak a pax path override onto a following entry", () => {
    const tarball = buildTarball([
      buildPaxEntry({ path: "package/first.md" }),
      { name: "package/one.md", content: "one" },
      { name: "package/two.md", content: "two" },
    ]);

    const entries = extractPackageTarball({ tarball });

    expect(entries.map((entry) => entry.relativePath)).toEqual(["first.md", "two.md"]);
  });

  it("enforces the max file count", () => {
    const tarball = buildTarball([
      { name: "package/a.md", content: "a" },
      { name: "package/b.md", content: "b" },
      { name: "package/c.md", content: "c" },
    ]);

    expect(() => extractPackageTarball({ tarball, maxFiles: 2 })).toThrow(/max file count/);
  });

  it("enforces the max total extracted bytes", () => {
    const tarball = buildTarball([
      { name: "package/a.md", content: "x".repeat(600) },
      { name: "package/b.md", content: "y".repeat(600) },
    ]);

    expect(() => extractPackageTarball({ tarball, maxTotalBytes: 1000 })).toThrow(/max total size/);
  });

  it("throws on truncated archives", () => {
    const tar = buildTar([{ name: "package/a.md", content: "abc" }]);
    // Cut the archive in the middle of the file data.
    const truncated = gzipSync(tar.subarray(0, 512 + 1));

    expect(() => extractPackageTarball({ tarball: truncated })).toThrow(/Truncated/);
  });

  it("throws on header checksum mismatches", () => {
    const tarball = buildTarball([{ name: "package/a.md", content: "abc", corruptChecksum: true }]);

    expect(() => extractPackageTarball({ tarball })).toThrow(/checksum/);
  });

  it("throws on non-gzip input", () => {
    expect(() => extractPackageTarball({ tarball: Buffer.from("not a tarball") })).toThrow(
      /gunzip/,
    );
  });

  it("rejects pax size overrides instead of misparsing offsets", () => {
    const tarball = buildTarball([
      buildPaxEntry({ size: "123" }),
      { name: "package/a.md", content: "abc" },
    ]);

    expect(() => extractPackageTarball({ tarball })).toThrow(/pax size/);
  });

  it("skips entries that resolve to the package root itself", () => {
    const tarball = buildTarball([
      { name: "package", content: "weird root file entry" },
      { name: "package/real.md", content: "real" },
    ]);

    const entries = extractPackageTarball({ tarball });

    expect(entries).toEqual([{ relativePath: "real.md", content: Buffer.from("real") }]);
  });
});
