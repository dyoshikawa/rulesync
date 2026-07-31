# typed: false
# frozen_string_literal: true

# This file is regenerated on each release by the `goal-release` skill
# (scripts/generate-homebrew-formula.ts) after the release assets are built.
# Do not edit it by hand; changes are overwritten on the next release.
class Rulesync < Formula
  desc "Unified AI rules management CLI that generates config files for AI dev tools"
  homepage "https://github.com/dyoshikawa/rulesync"
  version "16.4.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-arm64"
      sha256 "e09a10e36de3d995c85f995548c91b72151bbce781ca7e1531de4d2b84e380a4"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-darwin-x64"
      sha256 "d7a025798bc08f822ea31da0f1e52b804f1ab310571128a60dc88cbc2be133fb"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-arm64"
      sha256 "d191c34541e29afd2458ac62707f70142f3c526f8169243d5cf65572ac77a30a"
    end
    on_intel do
      url "https://github.com/dyoshikawa/rulesync/releases/download/v#{version}/rulesync-linux-x64"
      sha256 "7a6d1115c3b6a3272d91967389fb2b4087c0e78619e7f49697a4beb555a4b10a"
    end
  end

  def install
    bin.install Dir["rulesync-*"].first => "rulesync"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rulesync --version")
  end
end
