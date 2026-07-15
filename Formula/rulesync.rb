# typed: false
# frozen_string_literal: true

# This file is generated on each release by the "homebrew" job in
# .github/workflows/publish.yml (scripts/generate-homebrew-formula.ts).
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "11.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "0643da1f9650c9c1b58b0cf4d8f162758f49dcd2238bf8f393f285c297bfd222"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "10b32d51eb10889d3f0503e98153a804a98216fca2b6bcaf5778539fd4df3e8d"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "7fee104020bd36d79301d942bec63ed13f325187b87cfdb69390daf790fba5bb"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "fb864861c1b1374d343ac4acc8aa8f9b509b0cb06b29b3fc047a581acc07e7a5"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
