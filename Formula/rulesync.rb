# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the `goal-release` skill
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "16.34.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "8d4264196eb694b39b5f8e7d5a812f2a700ef4a1af65f9853d01ff56e3593b67"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "b9a3b6a3b953434f67ffb36963ab445387a33bd5b2783cb65cad4101040b814a"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "74c043707c84db4e96edf9828f7b8fd296f07326bb05a6253e5512366324b669"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "8ba1fd539a9d7f9b2c41d15657c7f25c2df81e6e7529a75672909a7ff054886b"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
