# typed: false
# frozen_string_literal: true

# This file is generated on each release by the "homebrew" job in
# .github/workflows/publish.yml (scripts/generate-homebrew-formula.ts).
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "10.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "6c03e4effbcb15b0b89963da85cdbec2d05be280ab667a53286af30ae480cf79"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "3aea5c85edbd21681e8672961a06e7ddde5a96a93bb91ca7aa5ceaaf0272eaad"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "86b0f5ae95295d9a12d669f51b1f0042a18249c872a8a0e482a939a49db0c815"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "ba3c86aded040e132ee2a9fc406b84cfaa408cf29bc33fec89f2ab81c4c69d36"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
