## Installation

### Package Managers

```bash
npm install -g rulesync
# or
brew install rulesync

# And then
rulesync --version
rulesync --help
```

### Single Binary (Experimental)

Download pre-built binaries from the [latest release](https://github.com/dyoshikawa/rulesync/releases/latest). These binaries are built using [Bun's single-file executable bundler](https://bun.sh/docs/bundler/executables).

**Quick Install (Linux/macOS - No sudo required):**

```bash
curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
```

Options:

- Install specific version: `curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash -s -- v6.4.0`
- Custom directory: `RULESYNC_HOME=~/.local curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash`

<details>
<summary>Manual installation (requires sudo)</summary>

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

</details>
