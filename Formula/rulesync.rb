# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the /goal-release command
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "9.8.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "f1e51045fcc976542d8a6b7061c7d5b04a7908da0f676185a4ed06632530eccd"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "09f0ccc6b581f0198708f8f072031576116d33185d964b8dfe840e81beb34820"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "594da40d1b96d087302559d62b3880e14cb31bd1ee19e2686a0dbb70c9b5fdf7"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "f7ca7be64ec39385579b61fc8834886dfa947b374901afd7992381080dd42636"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
