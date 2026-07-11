# typed: false
# frozen_string_literal: true

# This file is generated on each release by the "homebrew" job in
# .github/workflows/publish.yml (scripts/generate-homebrew-formula.ts).
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "9.6.3"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "90844bbf409016b3641578ff4a8508a1d748d558933c66c9ff74471e1a250492"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "1ac8cf074608a02d5a16d4a9f331b560757db5ed1821229622d10fcadb9f46d4"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "3bf6af02261ee1ac6fa5533a3db2a76554ba93819313533cf419182bc9dc202f"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "613a098b1d9f993151ade442edd7383d1f30972600dda5cdd8f7343bec1c5404"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
