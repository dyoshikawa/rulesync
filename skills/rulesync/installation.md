# Installation

## Package Managers

```bash
npm install -g rulesync

# And then
rulesync --version
rulesync --help
```

## Homebrew (macOS and Linux)

rulesync ships a self-contained [Homebrew](https://brew.sh/) tap inside this
repository. Because the repository is not named `homebrew-rulesync`, you must use
the two-argument `brew tap <name> <url>` form to add it — the auto-tap shorthand
`brew install dyoshikawa/rulesync/rulesync` cannot resolve it on its own:

```bash
brew tap dyoshikawa/rulesync https://github.com/dyoshikawa/rulesync
brew install rulesync

# And then
rulesync --version
```

The formula installs the prebuilt binary for your platform (macOS/Linux, arm64
and x64), so it does not depend on a Node.js runtime. It is updated as part of
each release. Homebrew does not support Windows; use npm or the
single-binary download below there.

## Single Binary

Download pre-built binaries from the [latest release](https://github.com/dyoshikawa/rulesync/releases/latest). These binaries are built using [Bun's single-file executable bundler](https://bun.sh/docs/bundler/executables).

**Quick Install (Linux/macOS - No sudo required):**

```bash
curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
```

Options:

- Install specific version: `curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash -s -- v6.4.0`
- Custom directory: `RULESYNC_HOME=~/.local curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash`

#### Manual installation (requires sudo)

#### Linux (x64)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-linux-x64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### Linux (ARM64)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-linux-arm64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### macOS (Apple Silicon)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-darwin-arm64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### macOS (Intel)

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-darwin-x64 -o rulesync && \
  chmod +x rulesync && \
  sudo mv rulesync /usr/local/bin/
```

#### Windows (x64)

```powershell
Invoke-WebRequest -Uri "https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-windows-x64.exe" -OutFile "rulesync.exe"; `
  Move-Item rulesync.exe C:\Windows\System32\
```

Or using curl (if available):

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/rulesync-windows-x64.exe -o rulesync.exe && \
  mv rulesync.exe /path/to/your/bin/
```

#### Verify checksums

```bash
curl -L https://github.com/dyoshikawa/rulesync/releases/latest/download/SHA256SUMS -o SHA256SUMS

# Linux/macOS
sha256sum -c SHA256SUMS

# Windows (PowerShell)
# Download SHA256SUMS file first, then verify:
Get-FileHash rulesync.exe -Algorithm SHA256 | ForEach-Object {
  $actual = $_.Hash.ToLower()
  $expected = (Get-Content SHA256SUMS | Select-String "rulesync-windows-x64.exe").ToString().Split()[0]
  if ($actual -eq $expected) { "✓ Checksum verified" } else { "✗ Checksum mismatch" }
}
```

#### Verify build provenance

Release binaries carry [GitHub Artifact Attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations), so you can check that the file you downloaded really was built by this repository's release workflow. This needs the [GitHub CLI](https://cli.github.com/) v2.49.0 or later, which is where `gh attestation` was introduced:

```bash
# Linux/macOS — the path the steps above saved the binary to
gh attestation verify /usr/local/bin/rulesync --repo dyoshikawa/rulesync

# Windows (PowerShell)
gh attestation verify rulesync.exe --repo dyoshikawa/rulesync
```

Pass the path you actually saved the binary to. The command identifies the file by its contents, not by its name, so renaming it during installation — which the steps above do — does not affect verification.
