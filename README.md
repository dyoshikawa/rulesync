<p align="center">
  <img src="images/logo.jpg" alt="Rulesync Logo" width="600">
</p>

# Rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rulesync)](https://www.npmjs.com/package/rulesync)
[![npm downloads](https://img.shields.io/npm/dt/rulesync)](https://www.npmjs.com/package/rulesync)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dyoshikawa/rulesync)
[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)
[![Mentioned in Awesome Gemini CLI](https://awesome.re/mentioned-badge.svg)](https://github.com/Piebald-AI/awesome-gemini-cli)
<a href="https://flatt.tech/oss/gmo/trampoline" target="_blank"><img src="https://flatt.tech/assets/images/badges/gmo-oss.svg" height="24px"/></a>

**[Documentation](https://dyoshikawa.github.io/rulesync/)** | **[npm](https://www.npmjs.com/package/rulesync)**

A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. Features selective generation, comprehensive import/export capabilities, and supports major AI development tools with rules, commands, MCP, ignore files, subagents and skills.

> [!NOTE]
> If you are interested in Rulesync latest news, please follow the maintainer's X(Twitter) account:
> [@dyoshikawa1993](https://x.com/dyoshikawa1993)

## Installation

```bash
npm install -g rulesync
# or
brew install rulesync
```

### Single Binary

```bash
curl -fsSL https://github.com/dyoshikawa/rulesync/releases/latest/download/install.sh | bash
```

See [Installation docs](https://dyoshikawa.github.io/rulesync/getting-started/installation) for manual install and platform-specific instructions.

## Getting Started

```bash
# Create necessary directories, sample rule files, and configuration file
rulesync init

# Install official skills (recommended)
rulesync fetch dyoshikawa/rulesync --features skills

# Generate unified configurations with all features
rulesync generate --targets "*" --features "*"
```

If you already have AI tool configurations:

```bash
# Import existing files (to .rulesync/**/*)
rulesync import --targets claudecode    # From CLAUDE.md
rulesync import --targets cursor        # From .cursorrules
rulesync import --targets copilot       # From .github/copilot-instructions.md
```

Want to convert configuration from one AI tool to another directly, without
adopting the `.rulesync/` source-of-truth workflow?

```bash
# Convert Cursor rules to Copilot and Claude Code in one shot (no .rulesync/ files written)
rulesync convert --from cursor --to copilot,claudecode
```

See [Quick Start guide](https://dyoshikawa.github.io/rulesync/getting-started/quick-start) for more details.

## Supported Tools and Features

The tables below show whether each tool supports a given feature (✅ = supported, blank = not supported). A ✅ means the feature is supported in at least one mode (project, global, or simulated) — for example, Codex CLI `commands` is global-only. For each tool's `--targets` value and full mode breakdown (project / global / simulated / MCP tool config), see the [Supported Tools reference](https://dyoshikawa.github.io/rulesync/reference/supported-tools).

### AI Coding Tools

<!-- SUPPORTED_TOOLS_AI:BEGIN -->

| Tool                   | rules | ignore | mcp | commands | subagents | skills | hooks | permissions |
| ---------------------- | :---: | :----: | :-: | :------: | :-------: | :----: | :---: | :---------: |
| Amp                    |  ✅   |        | ✅  |          |           |   ✅   |       |     ✅      |
| Claude Code            |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Codex CLI              |  ✅   |        | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Gemini CLI ⚠️          |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| GitHub Copilot         |  ✅   |        | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |             |
| GitHub Copilot CLI     |  ✅   |        | ✅  |          |    ✅     |   ✅   |  ✅   |             |
| Goose                  |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Hermes Agent           |  ✅   |        | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Grok CLI               |  ✅   |        | ✅  |          |    ✅     |   ✅   |       |     ✅      |
| Cursor                 |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| deepagents-cli         |  ✅   |        | ✅  |          |    ✅     |   ✅   |  ✅   |             |
| Factory Droid          |  ✅   |        | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| OpenCode               |  ✅   |        | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Cline                  |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |       |     ✅      |
| Kilo Code              |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Roo Code               |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |       |             |
| Rovodev (Atlassian)    |  ✅   |        | ✅  |          |    ✅     |   ✅   |       |     ✅      |
| Takt                   |  ✅   |        |     |    ✅    |    ✅     |   ✅   |       |     ✅      |
| Vibe Code              |  ✅   |   ✅   | ✅  |          |    ✅     |   ✅   |  ✅   |     ✅      |
| Qwen Code              |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Reasonix               |       |        | ✅  |          |           |        |       |             |
| Kiro ⚠️                |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Kiro CLI               |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Kiro IDE               |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |       |     ✅      |
| Google Antigravity IDE |  ✅   |        | ✅  |    ✅    |           |   ✅   |  ✅   |     ✅      |
| Google Antigravity CLI |  ✅   |   ✅   | ✅  |          |           |   ✅   |  ✅   |     ✅      |
| Google Antigravity ⚠️  |  ✅   |        |     |    ✅    |           |   ✅   |       |             |
| JetBrains AI Assistant |  ✅   |   ✅   |     |          |           |        |       |             |
| JetBrains Junie        |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |             |
| AugmentCode            |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |     ✅      |
| Devin Desktop          |  ✅   |   ✅   | ✅  |    ✅    |    ✅     |   ✅   |  ✅   |             |
| Warp                   |  ✅   |   ✅   | ✅  |          |           |   ✅   |       |     ✅      |
| Replit                 |  ✅   |        |     |          |           |   ✅   |       |             |
| Pi Coding Agent        |  ✅   |        |     |    ✅    |           |   ✅   |       |             |
| Zed                    |  ✅   |   ✅   | ✅  |          |           |   ✅   |       |     ✅      |

<!-- SUPPORTED_TOOLS_AI:END -->

### Open Standards

<!-- SUPPORTED_TOOLS_STANDARD:BEGIN -->

| Tool         | rules | ignore | mcp | commands | subagents | skills | hooks | permissions |
| ------------ | :---: | :----: | :-: | :------: | :-------: | :----: | :---: | :---------: |
| AGENTS.md    |  ✅   |        |     |    ✅    |    ✅     |   ✅   |       |             |
| AgentsSkills |       |        |     |          |           |   ✅   |       |             |

<!-- SUPPORTED_TOOLS_STANDARD:END -->

- ⚠️: Deprecated — still supported, but see the note below

### Deprecation notes

- **Gemini CLI (`geminicli`)** — Google is retiring Gemini CLI on **June 18, 2026**, when it stops serving requests for Google AI Pro/Ultra and free Gemini Code Assist for individuals (Enterprise plans are unaffected). The successor is the **Antigravity CLI (`antigravity-cli`)**. `geminicli` is **not** removed from rulesync — Enterprise access continues and existing `GEMINI.md`/`.gemini/` repositories still rely on it — but new projects should prefer `antigravity-cli`. See the [Gemini CLI → Antigravity CLI migration guide](https://dyoshikawa.github.io/rulesync/guide/geminicli-to-antigravity-cli).
- **Google Antigravity (`antigravity`)** — Antigravity 2.0 splits into two products with separate global config trees: the desktop **`antigravity-ide`** and the **`antigravity-cli`** (`agy`). The legacy `antigravity` target is now a **deprecated alias for `antigravity-ide`** that keeps its original `.agent/` (singular) paths for backward compatibility. Migrate to `antigravity-ide` (desktop IDE) or `antigravity-cli` (CLI). For project-scope rules, **both `antigravity-ide` and `antigravity-cli`** emit the root rule as a plain cross-tool **`AGENTS.md`** at the project root (the Gemini-lineage discovery order is `AGENTS.md`, `CONTEXT.md`, `GEMINI.md`; the IDE has read `AGENTS.md` since v1.20.3) and non-root rules under `.agents/rules/`.
- **Kiro (`kiro`)** — Kiro's IDE and CLI use diverging config formats (IDE: Markdown subagents `.kiro/agents/*.md` and `.kiro/hooks/*.kiro.hook`; CLI: JSON agent-config subagents `.kiro/agents/*.json` and hooks in `.kiro/agents/default.json`), so `kiro` is split into **`kiro-cli`** and **`kiro-ide`**. The legacy `kiro` target remains as a **deprecated alias** with its current behavior unchanged. The two targets share every surface except **subagents** (Markdown vs JSON); Kiro IDE multi-file `.kiro.hook` hooks are not yet supported, so use `kiro-cli` for agent hooks.

Some features accept per-feature options (e.g., Claude Code's `ignore` feature supports `fileMode: "local"` to write to `settings.local.json` instead of `settings.json`). See [Configuration > Per-feature options](https://dyoshikawa.github.io/rulesync/guide/configuration#per-feature-options) for details.

## Documentation

For full documentation including configuration, CLI reference, file formats, programmatic API, and more, visit the **[documentation site](https://dyoshikawa.github.io/rulesync/)**.

## License

MIT License
