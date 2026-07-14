# typed: false
# frozen_string_literal: true

# This file is generated on each release by the "homebrew" job in
# .github/workflows/publish.yml (scripts/generate-homebrew-formula.ts).
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "9.7.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "2a74b72a5f4bf87a925088a7eca41ea420cfa0226896dc9d2178ba6bfe735326"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "279b57d476def520bc9aee01725d1fe1fdf13998ccdea8dd5b13151d204d5f01"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "c26a1518b563f96a8549406b4c26a7ed46c8360786d732e47eecf9bcf4fff704"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "b5241cef579d32a4ac40a67d417888f7052f911095d587346d8349740f2fa209"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
