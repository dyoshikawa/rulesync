# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the `goal-release` skill
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "43.1.2"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "a086bfe460a17d356ac2fabd2f8f06e16cf0ac957de3dd4162f8cec542e08452"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "ac3fb0fe67ab3d3b51799ab13210dd46812b1f231217f5a028a73c5d5ab838cd"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "1f0ef180e7593cf1ab6f0386df7c11a1f4534b2f6775ea958fa666d04b73fed1"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "e3a190ad9386313752b1ca4d6de058b1b3675b354c7bcc899ca8117d17e6fa04"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
