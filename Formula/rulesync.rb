# typed: false
# frozen_string_literal: true

# This file is generated on each release by the "homebrew" job in
# .github/workflows/publish.yml (scripts/generate-homebrew-formula.ts).
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "10.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "99a6e95dfee8da644549a82df7db03e1086dd765d849c9ec3947e7645678dc7c"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "e4cf6b24691389968d0b1deb18ed185860e34ea3cbed99f98bd7af69cdcbbcc0"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "f043128183d1b3a7edf8d11fb54f3eb3e95aeee817938c9eb3a8676cdf03d6f5"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "f403e919546f67771b881f27ae193d14f6535ca209eee31b9c8226379fad5b47"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
