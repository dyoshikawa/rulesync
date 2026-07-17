# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the /goal-release command
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "14.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "a21a29a883925bdc2299c8f944eacd83ccd0f6416a6eb7abd1462d0b9aef5a37"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "4fa524afe4c572e3346f953178bbf368c1ed0c62ff6ad6d1bdcb0b012f76a619"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "82008b1ec6b77471c989b05f29dc856ddeed4da81e8d9a5117ffff9aef7b715a"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "a1011b0e158e07aa09faa2749ca9c24478f2183b868c6b467d0874b0b186a290"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
