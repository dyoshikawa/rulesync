import { describe, expect, it } from "vitest";

import {
  FORMULA_PLATFORMS,
  generateHomebrewFormula,
  parseSha256Sums,
  resolveFormulaShas,
} from "./generate-homebrew-formula.js";

const SAMPLE_SUMS = [
  "90844bbf409016b3641578ff4a8508a1d748d558933c66c9ff74471e1a250492  rulesync-darwin-arm64",
  "1ac8cf074608a02d5a16d4a9f331b560757db5ed1821229622d10fcadb9f46d4  rulesync-darwin-x64",
  "3bf6af02261ee1ac6fa5533a3db2a76554ba93819313533cf419182bc9dc202f  rulesync-linux-arm64",
  "613a098b1d9f993151ade442edd7383d1f30972600dda5cdd8f7343bec1c5404  rulesync-linux-x64",
  "5a4bc48edaf2dca0451b0296c7f76f8b4a3019f3951c3dfe4cc76be9737cceea  rulesync-windows-x64.exe",
].join("\n");

describe("parseSha256Sums", () => {
  it("parses plain sha256sum output into an asset-to-digest map", () => {
    const sums = parseSha256Sums(SAMPLE_SUMS);
    expect(sums["rulesync-darwin-arm64"]).toBe(
      "90844bbf409016b3641578ff4a8508a1d748d558933c66c9ff74471e1a250492",
    );
    expect(sums["rulesync-windows-x64.exe"]).toBe(
      "5a4bc48edaf2dca0451b0296c7f76f8b4a3019f3951c3dfe4cc76be9737cceea",
    );
  });

  it("accepts the binary-mode `*name` format and lowercases digests", () => {
    const sums = parseSha256Sums("ABCDEF0123456789".repeat(4) + " *rulesync-linux-x64");
    expect(sums["rulesync-linux-x64"]).toBe("abcdef0123456789".repeat(4));
  });

  it("ignores blank and malformed lines", () => {
    const sums = parseSha256Sums("\n  \nnot-a-checksum line\n");
    expect(Object.keys(sums)).toHaveLength(0);
  });
});

describe("resolveFormulaShas", () => {
  it("returns a digest for every required platform", () => {
    const shas = resolveFormulaShas(parseSha256Sums(SAMPLE_SUMS));
    for (const platform of FORMULA_PLATFORMS) {
      expect(shas[platform]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("throws when a platform binary is missing", () => {
    const partial = parseSha256Sums(
      "90844bbf409016b3641578ff4a8508a1d748d558933c66c9ff74471e1a250492  rulesync-darwin-arm64",
    );
    expect(() => resolveFormulaShas(partial)).toThrow(/Missing sha256 for rulesync-darwin-x64/);
  });
});

describe("generateHomebrewFormula", () => {
  const shas = resolveFormulaShas(parseSha256Sums(SAMPLE_SUMS));

  it("renders a formula with the version and all four checksums", () => {
    const formula = generateHomebrewFormula("9.6.3", shas);
    expect(formula).toContain('version "9.6.3"');
    expect(formula).toContain(`sha256 "${shas["darwin-arm64"]}"`);
    expect(formula).toContain(`sha256 "${shas["linux-x64"]}"`);
    // The URL interpolates the Homebrew `version` variable, not the literal.
    expect(formula).toContain(
      'url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"',
    );
    expect(formula).toContain("class Rulesync < Formula");
  });

  it("rejects a version with a leading v", () => {
    expect(() => generateHomebrewFormula("v9.6.3", shas)).toThrow(/Invalid version/);
  });

  it("rejects a non-semver version", () => {
    expect(() => generateHomebrewFormula("9.6", shas)).toThrow(/Invalid version/);
  });
});
