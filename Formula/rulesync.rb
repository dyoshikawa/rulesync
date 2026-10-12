# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the `goal-release` skill
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "33.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "cfb86bb04488dc8a1c2a2ff39a39a126988b3be7dd2dd19707554efa39924524"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "edfb9b5b8cb36284749c9c31ad17e7f805b1bbfd3b7497a5a32fa2c02a3bb714"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "d179b3e4071b10349262c380d555ca4781e01f176c93f4a4a70b4c529fa93f3b"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "c691b2c210bd6cc27abe60338164b2158c8523b965df08760658890aad1600db"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
