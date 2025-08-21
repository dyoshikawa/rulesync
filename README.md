# rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/rulesync.svg)](https://www.npmjs.com/package/rulesync)

A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. Uses the recommended `.rulesync/rules/*.md` structure, with backward compatibility for legacy `.rulesync/*.md` layouts. Also imports existing AI tool configurations into the unified format.

## Installation

```bash
npm install -g rulesync
# or
pnpm add -g rulesync
# or  
yarn global add rulesync
```

## Getting Started

### New Project

1. **Initialize your project:**
   ```bash
   # Recommended: Use new organized structure
   npx rulesync init
   
   # Legacy: Use backward-compatible structure
   npx rulesync init --legacy
   ```

2. **Edit the generated rule files:**
   - **Recommended**: Edit files in `.rulesync/rules/` directory
   - **Legacy**: Edit files in `.rulesync/` directory
   
3. **Generate tool-specific configuration files:**
   ```bash
   npx rulesync generate
   ```

### Existing Project

If you already have AI tool configurations:

```bash
# Import existing configurations (to recommended structure)
npx rulesync import --claudecode  # From CLAUDE.md
npx rulesync import --cursor      # From .cursorrules
npx rulesync import --copilot     # From .github/copilot-instructions.md
npx rulesync import --amazonqcli  # From .amazonq/rules/*.md
npx rulesync import --qwencode     # From QWEN.md
npx rulesync import --opencode    # From AGENTS.md
npx rulesync import --agentsmd    # From AGENTS.md + .agents/memories/*.md

# Import to legacy structure (for existing projects)
npx rulesync import --claudecode --legacy
npx rulesync import --cursor --legacy
npx rulesync import --copilot --legacy
npx rulesync import --amazonqcli --legacy
npx rulesync import --qwencode --legacy
npx rulesync import --opencode --legacy
npx rulesync import --agentsmd --legacy

# Generate unified configurations
npx rulesync generate
```

## Supported Tools

rulesync supports both **generation** and **import** for **15 AI development tools**:

- **GitHub Copilot Custom Instructions** (`.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`)
- **Cursor Project Rules** (`.cursor/rules/*.mdc` + `.cursorrules`) 
- **Cline Rules** (`.clinerules/*.md` + `.cline/instructions.md`)
- **Claude Code Memory** (`./CLAUDE.md` + `.claude/memories/*.md` + **Custom Slash Commands** `.claude/commands/*.md`)
- **Amazon Q Developer CLI** (`.amazonq/rules/*.md` + `.amazonq/mcp.json` + **Built-in Slash Commands** support + **Context Management**)
- **OpenCode** (`AGENTS.md` + `opencode.json` + **🔐 Permission-Based Security** instead of traditional ignore files)
- **OpenAI Codex CLI** (`AGENTS.md` + **File Splitting with XML References** `.codex/memories/*.md` + `.codex/mcp-config.json` + `.codexignore`)
- **AugmentCode Rules** (`.augment/rules/*.md`)
- **Roo Code Rules** (`.roo/rules/*.md` + `.roo/instructions.md`)
- **Gemini CLI** (`GEMINI.md` + `.gemini/memories/*.md` + **Custom Slash Commands** `.gemini/commands/*.md`)
- **Qwen Code** (`QWEN.md` + `.qwen/memories/*.md` + **Git-Aware Filtering** instead of traditional ignore files + `.qwen/settings.json` **MCP Configuration**)
- **JetBrains Junie Guidelines** (`.junie/guidelines.md`)
- **Kiro IDE Custom Steering Documents** (`.kiro/steering/*.md`) + **AI Ignore Files** (`.aiignore`)
- **Windsurf AI Code Editor** (`.windsurf/rules/*.md` + `.windsurf/mcp.json` + `.codeiumignore`)
- **AgentsMd** (`AGENTS.md` + `.agents/memories/*.md` for standardized AI agent instructions)

## Why rulesync?

### 🔧 **Tool Flexibility**
Team members can freely choose their preferred AI coding tools. Whether it's GitHub Copilot, Cursor, Cline, or Claude Code, each developer can use the tool that maximizes their productivity.

### 📈 **Future-Proof Development**
AI development tools evolve rapidly with new tools emerging frequently. With rulesync, switching between tools doesn't require redefining your rules from scratch.

### 🎯 **Multi-Tool Workflow**
Enable hybrid development workflows combining multiple AI tools:
- GitHub Copilot for code completion
- Cursor for refactoring
- Claude Code for architecture design
- Cline for debugging assistance
- **Amazon Q Developer CLI** for comprehensive chat-based development with built-in commands and MCP integration
- **OpenCode** for secure terminal-based development with granular permission controls
- Windsurf for comprehensive AI-assisted editing

### 🔓 **No Vendor Lock-in**
Avoid vendor lock-in completely. If you decide to stop using rulesync, you can continue using the generated rule files as-is.

### 🎯 **Consistency Across Tools**
Apply consistent rules across all AI tools, improving code quality and development experience for the entire team.

### 📁 **Organized Structure**
New organized directory structure (`.rulesync/rules/`) keeps rules well-organized, while maintaining full backward compatibility with legacy layouts (`.rulesync/*.md`) for existing projects.

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
npx rulesync init

# Initialize with legacy layout (backward compatibility)
npx rulesync init --legacy

# Add new rule file to recommended location
npx rulesync add typescript-rules

# Add rule file to legacy location (for existing projects)
npx rulesync add typescript-rules --legacy

# Import existing configurations (to .rulesync/rules/ by default)
npx rulesync import --cursor
npx rulesync import --amazonqcli
npx rulesync import --qwencode
npx rulesync import --agentsmd

# Import to legacy location (for existing projects)
npx rulesync import --cursor --legacy
npx rulesync import --amazonqcli --legacy
npx rulesync import --qwencode --legacy
npx rulesync import --agentsmd --legacy

# Validate rules
npx rulesync validate

# Generate configurations
npx rulesync generate

# Watch for changes
npx rulesync watch

# Show project status
npx rulesync status

# Add generated files to .gitignore
npx rulesync gitignore
```

## Programmatic API

rulesyncの機能をNode.js/TypeScriptアプリケーションから直接利用できます。

### 基本的な使用方法

```typescript
import { initialize, generate, getStatus, getSupportedTools } from 'rulesync';

// プロジェクトの初期化
const initResult = await initialize({
  baseDir: './my-project'
});

// 設定ファイルの生成
const generateResult = await generate({
  baseDirs: ['./my-project'],
  tools: ['cursor', 'claudecode', 'copilot']
});

// プロジェクトステータスの確認
const status = await getStatus({
  baseDir: './my-project'
});
```

### 利用可能なAPI関数

- **`initialize(options)`** - rulesyncプロジェクトの初期化
- **`generate(options)`** - AI開発ツール向け設定ファイルの生成
- **`importConfig(options)`** - 既存設定のrulesync形式へのインポート
- **`validate(options)`** - 設定の検証
- **`getStatus(options)`** - プロジェクトステータスの取得
- **`parseRules(options)`** - ルールファイルの解析
- **`loadConfig(options)`** - 設定ファイルの読み込み
- **`getSupportedTools()`** - サポートツール一覧の取得

完全なAPI仕様は [`tmp/rulesync-programmatic-api-specification.md`](./tmp/rulesync-programmatic-api-specification.md) を参照してください。

## Documentation

### 📖 Core Documentation
- **[Commands Reference](./docs/commands.md)** - Complete CLI commands guide
- **[Configuration Guide](./docs/configuration.md)** - Rule files and configuration options

### 🛠️ Tool Integrations
- **[Claude Code](./docs/tools/claudecode.md)** - Memory system and custom commands
- **[Cursor](./docs/tools/cursor.md)** - Rule types and MDC format
- **[GitHub Copilot](./docs/tools/copilot.md)** - Custom instructions
- **[Cline](./docs/tools/cline.md)** - Plain Markdown rules
- **[Amazon Q Developer CLI](./docs/tools/amazonqcli.md)** - Rules, MCP, and built-in commands
- **[OpenCode](./docs/tools/opencode.md)** - Permission-based configuration and MCP integration
- **[OpenAI Codex CLI](./docs/tools/codexcli.md)** - Advanced file splitting with XML document references and memory files
- **[Gemini CLI](./docs/tools/geminicli.md)** - Memory and commands
- **[Windsurf](./docs/tools/windsurf.md)** - Rules and Cascade AI
- **[JetBrains Junie](./docs/tools/junie.md)** - Guidelines and IDE integration
- **[Kiro IDE](./docs/tools/kiro.md)** - Custom steering documents
- **[AugmentCode](./docs/tools/augmentcode.md)** - Rule types and configuration
- **[Roo Code](./docs/tools/roo.md)** - Instructions and rules
- **[Qwen Code](./docs/tools/qwencode.md)** - Memory system with git-aware filtering
- **[AgentsMd](./docs/tools/agentsmd.md)** - Standardized AI agent instructions

### ⚡ Features
- **[Custom Slash Commands](./docs/features/custom-commands.md)** - Create unified commands for Claude Code and Gemini CLI
- **[MCP Integration](./docs/features/mcp.md)** - Model Context Protocol server configuration
- **[Import System](./docs/features/import.md)** - Import existing AI tool configurations
- **[Rule Validation](./docs/features/validation.md)** - Validate rule files and configuration

### 📚 Guides
- **[Getting Started](./docs/guides/getting-started.md)** - Comprehensive setup guide
- **[Best Practices](./docs/guides/best-practices.md)** - Proven strategies and patterns
- **[Migration Guide](./docs/guides/migration.md)** - Migrate from existing AI tool configurations
- **[Troubleshooting](./docs/guides/troubleshooting.md)** - Common issues and solutions
- **[Real-World Examples](./docs/guides/examples.md)** - Practical implementation examples

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

For development setup and contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).