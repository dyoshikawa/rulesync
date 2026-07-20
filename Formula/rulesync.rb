# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the /goal-release command
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "14.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "7895941f0a0a55e002de6d05f53d0fcdcc679c70f2c8b06f2934d31d826cf797"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "03dd7d94ffb9204f77b088fbe6932a3a4cb417eab8f75fbd2f892c5750e867f2"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "80ba2ee320376f9f152c53387c45a7b0c67f1bd27d84b8e2ef22db80c24c82ce"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "3914c8bc727e75e6f149f8dab0c86eb5a8fb91a3f2a1b3a1549c58daee3b2903"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
