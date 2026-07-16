import { readFileSync, writeFileSync } from "node:fs";

/**
 * Generates the Homebrew tap formula (`Formula/rulesync.rb`) from a released
 * version and the sha256 checksums of the per-platform binaries that
 * `publish-assets.yml` uploads to the GitHub release. The formula installs the
 * prebuilt Bun binary directly, so it needs no `node` runtime dependency.
 */

export const FORMULA_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
] as const;

export type FormulaPlatform = (typeof FORMULA_PLATFORMS)[number];

export type FormulaShas = Record<FormulaPlatform, string>;

/**
 * Parses a `sha256sum`-formatted file into a map of asset name to lowercase
 * hex digest. Both the plain (`<hash>  <name>`) and binary (`<hash> *<name>`)
 * output formats are accepted.
 */
export function parseSha256Sums(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
    if (match?.[1] && match[2]) {
      result[match[2]] = match[1].toLowerCase();
    }
  }
  return result;
}

/**
 * Resolves the four required binary checksums from a parsed SHA256SUMS map,
 * throwing when any platform binary is missing.
 */
export function resolveFormulaShas(sums: Record<string, string>): FormulaShas {
  const shas = {} as FormulaShas;
  for (const platform of FORMULA_PLATFORMS) {
    const sha = sums[`rulesync-${platform}`];
    if (!sha) {
      throw new Error(`Missing sha256 for rulesync-${platform} in SHA256SUMS`);
    }
    shas[platform] = sha;
  }
  return shas;
}

/**
 * Builds the release download URL for an asset. The `#{version}` token is
 * interpolated by Homebrew at install time, not by this script.
 */
function downloadUrl(asset: string): string {
  return `https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/${asset}`;
}

/**
 * Renders the Ruby formula source for the given version (without a leading
 * `v`) and per-platform checksums.
 */
export function generateHomebrewFormula(version: string, shas: FormulaShas): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version (expected X.Y.Z without a leading 'v'): ${version}`);
  }

  return `# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the /goal-release command
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${downloadUrl("rulesync-darwin-arm64")}"
      sha256 "${shas["darwin-arm64"]}"
    end
    on_intel do
      url "${downloadUrl("rulesync-darwin-x64")}"
      sha256 "${shas["darwin-x64"]}"
    end
  end

  on_linux do
    on_arm do
      url "${downloadUrl("rulesync-linux-arm64")}"
      sha256 "${shas["linux-arm64"]}"
    end
    on_intel do
      url "${downloadUrl("rulesync-linux-x64")}"
      sha256 "${shas["linux-x64"]}"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
`;
}

function main(): void {
  const [version, sumsPath, outPath] = process.argv.slice(2);
  if (!version || !sumsPath || !outPath) {
    throw new Error(
      "Usage: tsx scripts/generate-homebrew-formula.ts <version> <SHA256SUMS path> <output path>",
    );
  }

  const sums = parseSha256Sums(readFileSync(sumsPath, "utf8"));
  const shas = resolveFormulaShas(sums);
  const formula = generateHomebrewFormula(version, shas);
  writeFileSync(outPath, formula);
  // oxlint-disable-next-line no-console
  console.log(`Wrote ${outPath} for v${version}`);
}

// Only run the CLI when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
