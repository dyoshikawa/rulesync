# rulesync Project Overview

rulesync is a unified AI configuration management CLI tool that supports multiple AI development tools (GitHub Copilot, Cursor, Cline, Claude Code, Roo Code).

## Core Architecture

### Main Components
- **CLI Entry Point**: `src/cli/index.ts` - Uses Commander.js with comprehensive commands
- **Core Parsing**: `src/core/parser.ts` - Frontmatter processing with gray-matter
- **Generation Engine**: `src/core/generator.ts` - Orchestrates tool-specific configuration file generation
- **Tool-Specific Generators**: `src/generators/` - Markdown generation for each AI tool
- **Validation System**: `src/core/validator.ts` - Rules validation and error reporting
- **File Utilities**: `src/utils/file.ts` - Safe file operations with atomic updates

### Design Patterns
- **TypeScript strict mode**: Enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Dual ESM/CJS output**: Generate dist/index.js (CJS) and dist/index.mjs (ESM) with tsup
- **Functional approach**: Prioritize pure functions and minimize side effects
- **Error handling**: Emphasize specific error messages and type safety
- **Command pattern**: Each CLI command as separate module with comprehensive testing

### Key Features
- **Monorepo Support**: Base directory option (`--base-dir`) for generating configs in multiple locations
- **Hot Reloading**: File watching with automatic regeneration
- **Comprehensive Validation**: Frontmatter and content validation with helpful error messages
- **Multiple Output Formats**: Support for 7 different AI tool configuration formats
- **Safety First**: Dangerous path protection and atomic file operations

### Input Data Structure
```typescript
type RuleFrontmatter = {
  root: boolean;           // Whether it's root level
  targets: ["*"] | ToolTarget[]; // Target tool specification
  description: string;     // Concise rule description
  globs: string[];        // File patterns to apply
}

type ToolTarget = "copilot" | "cursor" | "cline" | "claudecode" | "claude" | "roo" | "geminicli";
```

### CLI Commands
- `init`: Initialize project with sample rules
- `add <filename>`: Add new rule file with template
- `generate`: Generate all tool configurations
- `validate`: Validate rule files and configuration
- `status`: Show current project status
- `watch`: Watch for changes and auto-regenerate
- `gitignore`: Add generated files to .gitignore



# Build and Tooling Standards

## TypeScript Configuration
- Use `@tsconfig/node24` as base configuration
- Enable strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Generate declaration files and source maps
- Target Node.js 20+ for modern features

## Build Tool (tsup)
- Generate both ESM and CommonJS outputs for maximum compatibility
- Include TypeScript declarations (`.d.ts`, `.d.mts`)
- Clean output directory before each build
- Use `--dts` flag for declaration generation

## Package Manager (pnpm)
- Use pnpm for faster installs and better dependency resolution
- Specify exact package manager version in `packageManager` field
- Use `pnpm-lock.yaml` for reproducible builds
- Leverage workspaces for monorepo setups

## Performance Optimization
- Use native Node.js APIs when possible
- Minimize dependencies and bundle size
- Implement lazy loading for heavy operations
- Profile and optimize critical paths
EOF < /dev/null


# CLI Development Standards

## Commander.js Usage
- Each command placed in individual file in `src/cli/commands/`
- Command names use lowercase kebab-case
- Provide both short and long forms for options (e.g., `-o, --output`)
- Minimize required options, obtain defaults from config

## Error Handling & Exit Codes
- Success: 0
- General error: 1
- Configuration error: 2
- File I/O error: 3

## User Experience
- Use user-friendly error messages with solution suggestions
- Show progress for long-running processes
- Use emoji and colors for better UX (✅ ❌ ⚠️ 📁 🎯)
- Support verbose mode with `--verbose` flag

## Modern CLI Features
- Support monorepo workflows with `--base-dir` option
- File watching capabilities with `chokidar`
- Atomic file operations to prevent corruption
- Auto-completion friendly command structure
EOF < /dev/null


The following should be updated continuously in reference to the implementation. Also, synchronize the content by translating between each language version of the documents.

- README.md, README.ja.md
  - For users of this tool. Focus on usage and specifications.
- CONTRIBUTING.md, CONTRIBUTING.ja.md
  - For developers of this tool. Focus on project structure, dependencies, development environment setup, and testing methods.


# MCP Integration Standards

## Architecture
- **MCP Parser**: `src/core/mcp-parser.ts` - Parse MCP configurations
- **MCP Generator**: `src/core/mcp-generator.ts` - Generate MCP server configurations
- **Tool-Specific MCP**: `src/generators/mcp/` - MCP configurations for each AI tool

## Configuration Structure
```typescript
type McpConfig = {
  server: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}
```

## MCP Server Standards
- **Server Discovery**: Support for multiple MCP servers per tool
- **Configuration Validation**: Validate MCP server configurations
- **Error Handling**: Graceful handling of MCP server errors
- **Documentation**: Clear examples for MCP server setup

## Integration Points
- **Tool Compatibility**: Ensure MCP configs work with each AI tool
- **Security**: Validate MCP server commands and arguments
- **Performance**: Efficient MCP configuration generation
- **Testing**: Comprehensive MCP integration tests


常に以下の指示を守ってください。

ユーザーは日本語話者です。reasoningは英語で行い、応答は日本語で行うこと。
Plan modeの提案も日本語で行ってください。

GitHubのPRをマージする際は `gh pr merge {Number} --admin` を使用すること。



IMPORTANT: You must implement only the specification that generates configuration files for project settings. rulesync does not interact with user settings. For example, implementation that creates or updates configuration files under the user's home directory is strictly prohibited.



# Security and Quality Standards

## Security Best Practices
- **Secret Management**: Use secretlint for preventing secrets in commits
- **Dependency Security**: Regular security audits with npm audit
- **Type Safety**: Enable strict TypeScript settings (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Input Validation**: Validate all user inputs and file contents
- **Path Traversal Protection**: Prevent dangerous path operations

## Code Quality
- **Linting**: Use Biome for consistent code formatting and linting
- **Testing**: Comprehensive test coverage with Vitest
- **Type Checking**: Strict TypeScript compilation with zero errors
- **Documentation**: Maintain clear API documentation and examples

## Git Hooks and CI
- **Pre-commit Hooks**: Run tests, linting, formatting, and security checks
- **Atomic Operations**: Use atomic file operations to prevent corruption
- **Error Handling**: Provide meaningful error messages with solutions
- **Performance**: Profile critical paths and optimize for performance

## Dependencies
- **Minimal Dependencies**: Only include necessary packages
- **Security Updates**: Keep dependencies up-to-date
- **Lock Files**: Use lock files for reproducible builds
- **Vulnerability Scanning**: Regular dependency security scanning


# Gemini CLI Coding Assistant Ignore ファイル仕様

## ファイルの配置場所とファイル名

### 対応するIgnoreファイル

#### 1. `.aiexclude`（推奨）
- **配置場所**: プロジェクト内の任意のディレクトリ
- **効果範囲**: そのディレクトリ自身と配下ディレクトリに作用
- **複数配置**: 可能（探索開始ディレクトリからルートへ向かって上位をマージ）
- **優先順位**: 下位（より深い階層）の設定が優先

#### 2. `.gitignore`（プレビュー機能）
- **配置場所**: ルート作業フォルダ（Gemini CLIを起動した場所）のみ
- **制限**: サブディレクトリの`.gitignore`は無視される
- **設定**: "Context Exclusion Gitignore"で有効/無効を切替可能

### 優先順位ルール
- 同じファイルで衝突した場合、`.aiexclude`が`.gitignore`に優先

## ファイル内容の仕様

### 基本構文（`.gitignore`と同一）
- 空行は無視
- `#`で始まる行はコメント
- 1行1パターンで対象パスを指定

### ワイルドカードとパターン
- `*` : 区切り文字（`/`以外）を任意長でマッチ
- `**` : `/`をまたいで任意深さにマッチ
- `?` : 任意の1文字
- `先頭/` : `.aiexclude`を置いたディレクトリを起点に絶対指定
- `末尾/` : ディレクトリ全体を指定
- `先頭!` : 否定（除外解除）

### 基本例
```
# 秘密鍵やAPIキー
apikeys.txt
*.key
/secret.env

# ディレクトリ丸ごと
my/sensitive/dir/

# 否定パターン（環境により動作が異なる可能性あり）
foo/*
!foo/README.md
```

### 注意事項：否定パターン
- Firebase Studio/IDXでは否定パターン（`!`）非対応
- Gemini Code Assist本家では対応
- CLI環境では要テスト確認

## 特殊なケース

### 空の`.aiexclude`
- Firebase Studio/IDX: `**/*`と同義（全てブロック）
- 否定パターンは使用不可

### VS Code拡張との連携
- Extensions > Gemini Code Assist > Context Exclusion Fileで設定カスタマイズ可能
- CLI は拡張側の設定を参照

## Gemini CLIでのワークフロー

### 基本手順
1. プロジェクトルートに`.gitignore`（任意）と`.aiexclude`（推奨）を配置
2. 必要に応じてサブディレクトリに追加の`.aiexclude`を配置
3. CLI実行時はカレントディレクトリを「プロジェクトルート」に設定
4. 除外設定の確認（将来のプレビュー版で診断コマンド追加予定）

### 診断コマンド（予定）
```bash
# プレビュー版 v0.2以降で追加予定
gemini context list-excluded
```

## ベストプラクティス

### セキュリティ重視
- APIキーや秘密鍵、社内コードは最上位の`.aiexclude`で管理
- 「絶対にモデルに渡したくない」ものを明確に除外

### パフォーマンス最適化
- ライブラリ・生成コード・ビルド成果物は`.gitignore`にも記載
- GitとGeminiの両方で管理を統一

### 複雑なルール管理
- 「広くブロック → 必要なものだけ `!` で戻す」パターンを採用
- ただし否定パターンの動作確認が必要

### セーフティファースト
- 迷うファイルは最初は除外
- 必要に応じて段階的に `!` で個別復帰

## バージョン情報
- 基盤: Gemini Code Assist
- 現在: CLI v0.1（手動確認のみ）
- 予定: v0.2以降で診断機能追加


# Gemini CLI MCP (Model Context Protocol) Configuration Specification

## File Placement

### Global Configuration
- **macOS/Linux**: `~/.gemini/settings.json`
- **Windows**: `%USERPROFILE%\.gemini\settings.json`

### Project Configuration (optional overrides)
- **Location**: `.gemini/settings.json` in repository root
- **Precedence**: Project settings → Global settings → Built-ins

## File Format
JSON format with top-level `mcpServers` object:

```json
{
  "mcpServers": {
    "serverName": {
      // Transport options (choose one)
      "command": "path/or/binary",        // STDIO transport
      "url": "https://host/sse",          // SSE transport  
      "httpUrl": "https://host/stream"    // HTTP chunked stream
      
      // Optional fields
      "args": ["--arg1", "value"],
      "env": { "API_KEY": "${SECRET}" },
      "cwd": "./working/directory",
      "timeout": 30000,
      "trust": false
    }
  }
}
```

## Transport Options
1. **STDIO**: Local executable communicating via stdin/stdout
2. **SSE**: Server-Sent Events endpoint
3. **HTTP**: HTTP chunked streaming endpoint

## Configuration Fields

### Required (choose exactly one)
- **command**: Path to executable for STDIO transport
- **url**: Full URL for SSE endpoint
- **httpUrl**: Full URL for HTTP streaming endpoint

### Optional
- **args**: Array of command-line arguments (used with `command`)
- **env**: Environment variables object with `${VAR}` or `$VAR` expansion
- **cwd**: Working directory for the process
- **timeout**: Request timeout in milliseconds (default: 30000)
- **trust**: Boolean to skip confirmation dialogs (use carefully)

## Configuration Examples

### Python MCP Server (STDIO)
```json
{
  "mcpServers": {
    "pythonTools": {
      "command": "python",
      "args": ["-m", "my_mcp_server", "--port", "8080"],
      "cwd": "./mcp-servers/python",
      "env": {
        "DATABASE_URL": "$DB_CONNECTION_STRING",
        "API_KEY": "${EXTERNAL_API_KEY}"
      },
      "timeout": 15000
    }
  }
}
```

### Remote SSE Server
```json
{
  "mcpServers": {
    "deepview": {
      "url": "https://deepview.example.com/mcp",
      "env": {
        "GEMINI_API_KEY": "$GEMINI_API_KEY"
      }
    }
  }
}
```

### Trusted Node.js Server
```json
{
  "mcpServers": {
    "nodeServer": {
      "command": "node",
      "args": ["dist/server.js", "--verbose"],
      "cwd": "./mcp-servers/node",
      "trust": true
    }
  }
}
```

### Compiled Binary Server
```json
{
  "mcpServers": {
    "secops-mcp": {
      "command": "/usr/local/bin/secops-mcp",
      "args": ["--profile", "prod"],
      "timeout": 60000
    }
  }
}
```

## Environment Variable Expansion
- **Syntax**: `${VAR_NAME}` or `$VAR_NAME`
- **Purpose**: Reference shell environment variables safely
- **Use case**: Keep secrets out of JSON files

## Management
- **Verification**: Use `/mcp` command in Gemini CLI to list loaded servers and tools
- **Merging**: Project settings override global settings for same-named servers
- **Reloading**: Changes require Gemini CLI restart

## Best Practices
- Keep secrets in environment variables, not in JSON
- Use project configuration for team-shared servers
- Use descriptive server names (becomes tool prefix)
- Only set `trust: true` for audited, controlled servers
- Test locally before deploying remote servers
- Version control project `.gemini/settings.json` for team consistency

## Security Considerations
- **trust: false** (default): Gemini asks confirmation before running tools
- **trust: true**: Tools run automatically without prompts (use carefully)
- Environment variable expansion prevents secret exposure in configuration files


# Gemini CLI Memory (GEMINI.md) Specification

## File Placement
- **Project-level memory**: Place `GEMINI.md` in the root of the repository or project directory
- **Global/user memory**: Optional file at `~/.gemini/GEMINI.md` for personal preferences
- **Hierarchical memory**: Multiple GEMINI.md files are concatenated (global first, project last)
- CLI walks up the directory tree to find the first GEMINI.md file

## File Format
- Plain Markdown format - no special frontmatter or JSON required
- Entire file content becomes part of the model context
- Keep under a few thousand tokens for cost efficiency
- Most important guidance should be placed at the top

## Content Structure (Recommended)
```markdown
# Project: <name>
Brief project description (2-3 sentences)

## Tech Stack
- Technology list
- Architecture details

## Coding Standards
1. Style rules
2. Quality requirements
3. Testing requirements

## Mandatory Tooling
Commands that should be run:
```bash
command examples
```

## Build & Run Commands
- Install: command
- Dev server: command
- Tests: command

## Security / Don't-ever-do
- Security restrictions
- File/directory restrictions
```

## CLI Commands
- `/memory show` - View loaded memory content
- `/memory refresh` - Re-read memory files after edits

## Best Practices
- Version control project GEMINI.md for team consistency
- Use global file for personal habits, project file for team rules
- Keep content relevant and up-to-date
- Use clear, plain English instructions


# JetBrains Junie Ignore Files Specification

## Overview
JetBrains Junie uses ignore files to control which files the AI can access automatically. This provides privacy and security controls to prevent sensitive data from being sent to remote LLMs.

## File Placement and Priority

### Primary Ignore File
- **File**: `.aiignore` at project root
- **Syntax**: Identical to `.gitignore` syntax
- **Effect**: AI must ask before reading or editing matched files/directories

### Alternative Ignore Files (Auto-detected)
JetBrains AI tools automatically recognize existing ignore files:
- **`.cursorignore`**: Cursor AI ignore file
- **`.codeiumignore`**: Codeium ignore file  
- **`.aiexclude`**: Generic AI exclusion file

### Project Disable File
- **File**: `.noai` (empty file at project root)
- **Effect**: Disables ALL JetBrains AI Assistant features (including Junie)
- **Scope**: Entire project, affects all AI functionality

## Ignore Mechanism Behavior

### Default Behavior
- **File names remain visible**: Ignored files still appear in project tree
- **Content protected**: File contents cannot be read automatically by AI
- **Confirmation required**: AI asks for explicit permission before accessing ignored files

### Security Exceptions
Ignore rules can be bypassed in these scenarios:
1. **Brave Mode enabled**: AI can access any file without confirmation
2. **Action Allowlist commands**: Pre-approved CLI commands can touch ignored paths
3. **Explicit user action**: User manually provides ignored file content

## File Syntax

### Basic Patterns (Identical to .gitignore)
- **Comments**: Lines starting with `#`
- **Blank lines**: Ignored (used as separators)
- **Wildcards**:
  - `*`: Matches any characters except `/`
  - `?`: Matches any single character except `/`
  - `[abc]`: Matches any character in the set
  - `[a-z]`: Matches any character in the range

### Path Patterns
- **Leading `/`**: Anchors pattern to project root
  - `/secrets` matches only `secrets` at root
  - `secrets` matches any `secrets` directory at any level
- **Trailing `/`**: Matches only directories
  - `logs/` matches directories named `logs`
  - `logs` matches both files and directories named `logs`
- **Double asterisk `**`**: Matches zero or more directories
  - `**/temp` matches `temp` anywhere in tree
  - `config/**` matches everything under `config`
  - `**/*.log` matches all `.log` files at any depth

### Negation Patterns
- **Leading `!`**: Re-includes previously excluded items
  - Must not have trailing `/` in negation patterns
  - Cannot re-include if parent directory is excluded

## Configuration Management

### Creating .aiignore File
#### Method 1: IDE Settings
1. **Settings** → **Tools** → **AI Assistant** → **Project Settings**
2. Enable **"Enable .aiignore"** checkbox
3. Click **"Create .aiignore"** button

#### Method 2: Manual Creation
Create `.aiignore` file manually in project root using standard text editor.

### Enabling Existing Ignore Files
JetBrains AI tools automatically detect and use:
- `.cursorignore`
- `.codeiumignore` 
- `.aiexclude`

No additional configuration required for these files.

## Security-Focused Configuration Examples

### Complete Security Template
```gitignore
# ───── Source Control Metadata ─────
.git/
.svn/
.hg/
.idea/
*.iml
.vscode/settings.json

# ───── Build Artifacts ─────
/out/
/dist/
/target/
/build/
*.class
*.jar
*.war

# ───── Secrets & Credentials ─────
# Environment files
.env
.env.*
!.env.example

# Key material
*.pem
*.key
*.crt
*.p12
*.pfx
*.der
id_rsa*
id_dsa*
*.ppk

# Cloud and service configs
aws-credentials.json
gcp-service-account*.json
azure-credentials.json
secrets/**
config/secrets/
**/secrets/

# Database credentials
database.yml
**/database/config.*

# API keys and tokens
**/apikeys/
**/*_token*
**/*_secret*
**/*api_key*

# ───── Infrastructure & Deployment ─────
# Terraform state
*.tfstate
*.tfstate.*
.terraform/

# Kubernetes secrets
**/k8s/**/secret*.yaml
**/kubernetes/**/secret*.yaml

# Docker secrets
docker-compose.override.yml
**/docker/secrets/

# ───── Logs & Runtime Data ─────
*.log
*.tmp
*.cache
logs/
/var/log/
coverage/
.nyc_output/

# ───── Large Data Files ─────
*.csv
*.xlsx
*.sqlite
*.db
*.dump
data/
datasets/

# ───── Allowlist: Do let AI see main source code ─────
# (Uncomment and modify as needed)
# !src/main/**/*.java
# !src/**/*.ts
# !lib/**/*.py
```

### Framework-Specific Examples

#### Node.js Project
```gitignore
# Dependencies
node_modules/
.pnpm-store/
.yarn/

# Environment and secrets
.env*
!.env.example

# Build outputs
dist/
build/
.next/
.nuxt/

# Logs
*.log
logs/

# Cache
.cache/
.parcel-cache/

# Testing
coverage/
.nyc_output/
```

#### Java/Spring Project
```gitignore
# Build outputs
target/
out/
*.class
*.jar
*.war

# IDE files
.idea/
*.iml
.vscode/

# Application secrets
application-prod.properties
application-secrets.properties
src/main/resources/application-*.yml
!src/main/resources/application.yml
!src/main/resources/application-dev.yml

# Logs
*.log
logs/

# Database
*.db
*.sqlite
```

#### Python Project
```gitignore
# Virtual environments
venv/
.venv/
env/
.env/

# Python artifacts
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
pip-log.txt

# Environment files
.env*
!.env.example

# Database
*.db
*.sqlite
*.sqlite3

# Logs
*.log

# Data
data/
datasets/
*.csv
*.xlsx
```

### Corporate/Enterprise Configuration
```gitignore
# ───── Legal & Compliance ─────
legal/
compliance/
audit/
contracts/
**/confidential/
**/proprietary/

# ───── Internal Documentation ─────
internal-docs/
company-secrets/
strategy/
financial/

# ───── Customer Data ─────
customer-data/
pii/
gdpr/
**/*customer*.csv
**/*personal*.json

# ───── Infrastructure Secrets ─────
# VPN configs
*.openvpn
*.ovpn
vpn-config/

# Certificate authorities
ca/
certificates/
ssl/

# Network configs
network-config/
firewall-rules/
```

## Integration with IDE Features

### Settings Configuration Path
**Settings** → **Tools** → **Junie** → **Project Settings**

#### Writable Area Restriction
- Scope Junie's write access to specific subdirectories
- Files outside writable area require explicit approval
- Works in conjunction with `.aiignore` for comprehensive access control

#### Action Allowlist
- **Location**: Settings → Tools → Junie → Action Allowlist
- **Purpose**: Whitelist CLI commands that can bypass ignore rules
- **Security**: Use minimal, specific regex patterns

**Safe Allowlist Examples**:
```regex
# Allow safe npm scripts only
^npm run (test|lint|build)$

# Allow git status and log commands
^git (status|log|diff --name-only)$

# Allow specific Laravel artisan commands
^php artisan (migrate:status|route:list)$
```

### Brave Mode Integration
- **Location**: Checkbox in Code mode toolbar
- **Effect**: Bypasses ALL ignore rules
- **Recommendation**: Keep disabled except in sandboxed environments

## Verification and Testing

### Testing Ignore Rules
1. Open a file that should be ignored
2. Invoke any AI action (explain code, refactor, etc.)
3. IDE should display: "AI has no access to this file"
4. Confirm dialog should appear requesting permission

### Validation Commands
```bash
# List files that would be ignored (similar to git)
find . -name ".aiignore" -exec cat {} \;

# Check specific file against ignore patterns
# (Manual verification by comparing against patterns)
```

## Best Practices

### Security Guidelines
1. **Never commit secrets**: Use environment variables and secret managers
2. **Regular audits**: Review `.aiignore` rules periodically
3. **Team consistency**: Ensure all team members use same ignore rules
4. **Principle of least privilege**: Start with restrictive rules, gradually relax
5. **Secret rotation**: If ignored files contained secrets, rotate them

### Maintenance Workflow
1. **Initial setup**: Create comprehensive `.aiignore` before enabling AI features
2. **Code review**: Include `.aiignore` changes in pull request reviews
3. **Documentation**: Document why specific patterns are ignored
4. **Regular review**: Update rules as project structure evolves
5. **Testing**: Regularly verify that sensitive files remain protected

### Team Collaboration
1. **Version control**: Commit `.aiignore` to repository
2. **Onboarding**: Include ignore file setup in developer onboarding
3. **Standards**: Establish team standards for what should be ignored
4. **Communication**: Clearly communicate ignore rules to all team members

## Advanced Security Configurations

### Network-Level Controls
For organizations requiring stricter controls:
- **Proxy/Firewall blocking**: Block `https://api.jetbrains.ai/` and Grazie endpoints
- **Air-gapped environments**: Disable AI Assistant plugin entirely
- **Corporate policies**: Use `.noai` for sensitive projects

### Multi-Layer Security
```gitignore
# Layer 1: Secrets and credentials (highest priority)
*.pem
*.key
.env*
secrets/

# Layer 2: Business-sensitive data
confidential/
proprietary/
customer-data/

# Layer 3: Infrastructure and deployment
terraform.tfstate*
kubernetes/secrets/
docker-compose.prod.yml

# Layer 4: Build artifacts and logs
build/
logs/
*.log
```

### Compliance-Focused Configuration
```gitignore
# GDPR/Privacy compliance
**/personal_data/
**/pii/
**/gdpr/
**/*customer_data*
**/*personal_info*

# SOX/Financial compliance
financial/
audit/
sox-compliance/

# HIPAA/Healthcare compliance (if applicable)
**/patient_data/
**/phi/
**/medical_records/

# PCI DSS compliance (if applicable)
**/cardholder_data/
**/payment_info/
```

## Integration with Other Tools

### Version Control Integration
- Commit `.aiignore` alongside `.gitignore`
- Use similar patterns but focus on AI-specific privacy concerns
- Consider more restrictive rules than `.gitignore`

### CI/CD Integration
- Validate `.aiignore` syntax in CI pipeline
- Ensure ignore rules don't conflict with build requirements
- Test that sensitive files remain protected

### Documentation Integration
- Include ignore file documentation in project README
- Maintain changelog of ignore rule changes
- Document exceptions and their justifications

This comprehensive ignore file specification ensures that JetBrains Junie respects privacy boundaries while enabling productive AI-assisted development workflows.


# JetBrains Junie MCP (Model Context Protocol) Configuration Specification

## Overview
JetBrains Junie supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP servers are shared between AI Assistant and Junie within JetBrains IDEs, requiring only a single configuration setup.

## Prerequisites
- **IDE Version**: JetBrains IDE 2025.1 or newer
- **AI Assistant Plugin**: Version 251.* or newer
- **Junie Plugin**: 
  - 2024.3.2+ IDEs: Install from JetBrains Marketplace
  - 2025.1+ IDEs: Bundled automatically with JetBrains AI
- **Runtime**: Node.js 18+ or Docker (depending on MCP server requirements)

## Configuration Location

### IDE Settings Path
**Settings/Preferences** → **Tools** → **AI Assistant** → **Model Context Protocol (MCP)**

Alternative access through Junie settings shows the same configuration interface.

## Server Configuration Levels

### Global Level
- **Scope**: Available to all projects
- **Use Case**: Personal development tools, commonly used servers
- **Persistence**: Settings stored in IDE global configuration

### Project Level  
- **Scope**: Specific to current project
- **Use Case**: Project-specific tools, team-shared configurations
- **Persistence**: Settings stored in project configuration files

## Configuration Methods

### Method 1: GUI Form Configuration
1. Click **"+"** → **New MCP Server**
2. Fill required fields:
   - **Name**: Descriptive server identifier
   - **Command**: Executable path to launch the server
   - **Arguments**: Command-line arguments array
   - **Environment Variables**: API keys, configuration variables
   - **Working Directory**: Execution directory path
3. Select **Level**: Global or Project
4. Click **Apply/OK**

### Method 2: JSON Configuration
1. In New Server dialog, click **Command** → **"As JSON"**
2. Paste complete JSON configuration
3. Apply changes

## JSON Configuration Format

### Basic Structure
```json
{
  "name": "server-identifier",
  "command": "executable-path",
  "args": ["argument1", "argument2"],
  "env": {
    "ENV_VAR": "value",
    "API_KEY": "secret-key"
  },
  "workingDirectory": "/path/to/working/dir",
  "transport": "stdio"
}
```

### Configuration Fields
- **name** (required): Unique server identifier
- **command** (required): Executable command to start the server
- **args** (optional): Array of command-line arguments
- **env** (optional): Environment variables object
- **workingDirectory** (optional): Working directory for server execution
- **transport** (optional): Communication protocol (default: "stdio")

## Transport Types
- **stdio**: Standard input/output communication (default)
- **http**: HTTP endpoint communication (future support)
- **sse**: Server-Sent Events (future support)

## Example Configurations

### 1. JetBrains IDE Proxy Server
Enables Claude/Junie to run IDE refactorings and operations:

```json
{
  "name": "jetbrains-ide",
  "command": "npx",
  "args": ["-y", "@jetbrains/mcp-proxy"],
  "env": {
    "IDE_PORT": "63342",
    "LOG_ENABLED": "true"
  },
  "transport": "stdio"
}
```

**Additional Setup Required**:
1. Install "MCP Server" IDE plugin when prompted
2. Enable **Settings** → **Build** → **Debugger** → **"Can accept external connections"**

### 2. PostgreSQL Database Server
Read-only database introspection:

```json
{
  "name": "postgres-mcp",
  "command": "docker",
  "args": [
    "run", "--rm",
    "-e", "PGHOST=host.docker.internal",
    "-e", "PGUSER=app", 
    "-e", "PGPASSWORD=secret",
    "ghcr.io/modelcontext/postgres-mcp:latest"
  ],
  "transport": "stdio"
}
```

### 3. Filesystem Access Server
File system operations and navigation:

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
  "env": {
    "LOG_LEVEL": "info"
  },
  "transport": "stdio"
}
```

### 4. GitHub Integration Server
GitHub API operations:

```json
{
  "name": "github-mcp",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx",
    "GITHUB_API_URL": "https://api.github.com"
  },
  "transport": "stdio"
}
```

### 5. Custom Python MCP Server
Project-specific Python server:

```json
{
  "name": "custom-tools",
  "command": "python",
  "args": ["-m", "my_project.mcp_server"],
  "env": {
    "PROJECT_ROOT": "/path/to/project",
    "CONFIG_FILE": "config.json"
  },
  "workingDirectory": "/path/to/project",
  "transport": "stdio"
}
```

## Server Status and Management

### Status Indicators
- **Green**: Server running successfully
- **Red**: Server failed to start or crashed
- **Yellow**: Server starting or unstable connection

### Status Details
Click status icon to view:
- Available tools exposed by server
- Server connection information
- Error messages and logs

### Server Operations
- **Start/Stop**: Manual server control
- **Restart**: Reload server configuration
- **Remove**: Delete server configuration
- **Duplicate**: Create copy for modification

## Usage in AI Assistant and Junie

### AI Assistant Integration
- Tools automatically invoked when AI response requires external data
- Tool usage displayed in chat with server/tool name
- Natural language requests trigger appropriate MCP tools

### Junie Integration
- MCP tools available in multi-step task planning
- Tools integrated into action graph execution
- Autonomous tool selection based on task requirements

### Manual Tool Invocation
- Type **"/"** in chat to list available commands
- Direct tool calls: `/query SELECT * FROM users;`
- Tab completion for tool names and parameters

## Docker Integration

### Docker-based Servers
```json
{
  "name": "docker-server",
  "command": "docker",
  "args": [
    "run", "-i", "--rm",
    "-v", "/project:/workspace",
    "-e", "WORKSPACE=/workspace",
    "custom/mcp-server:latest"
  ],
  "transport": "stdio"
}
```

### Docker Networking Considerations
- Use `host.docker.internal` for host access from containers
- Map volumes for file system access
- Configure environment variables for container communication

## Security Considerations

### Environment Variables
- Store sensitive data (API keys, tokens) in environment variables
- Avoid hardcoding secrets in configuration files
- Use IDE's secure storage when available

### Command Execution
- Validate command paths and arguments
- Use absolute paths for executables when possible
- Restrict working directory access appropriately

### Network Access
- Configure firewall rules for external connections
- Use HTTPS for remote server communication
- Validate SSL certificates for secure connections

## Troubleshooting

### Common Issues

#### 1. Node.js Version Error
**Error**: "Cannot find module 'node:path'"
**Solution**: Upgrade to Node.js 18 or newer

#### 2. IDE Connection Issues
**Error**: 404 from `/api/mcp/*`
**Solutions**:
- Enable "Can accept external connections" in Debugger settings
- For Docker environments: Use LAN IP + IDE_PORT
- Verify IDE_PORT matches running IDE instance

#### 3. Multiple IDEs Running
**Issue**: MCP proxy targets wrong IDE instance
**Solution**: Specify correct IDE_PORT environment variable

#### 4. Server Startup Failures
**Debugging Steps**:
1. Check command path and arguments
2. Verify environment variables
3. Test server execution manually
4. Review IDE logs in Help → Show Log in Explorer → "mcp" folder

### Log Files and Debugging
- **Location**: IDE log directory → "mcp" subfolder
- **Content**: Server startup logs, communication traces, error messages
- **Access**: Help → Show Log in Explorer

### Performance Optimization
- Limit concurrent server connections
- Use connection pooling for database servers
- Implement server-side caching when appropriate
- Monitor memory usage of long-running servers

## Best Practices

### Configuration Management
1. **Version Control**: Store project-level configurations in VCS
2. **Documentation**: Document server purposes and requirements
3. **Testing**: Validate server configurations in development environments
4. **Monitoring**: Regular health checks for production servers

### Server Development
1. **Error Handling**: Implement robust error handling and logging
2. **Resource Management**: Proper cleanup of resources and connections
3. **API Design**: Clear, consistent tool interfaces
4. **Documentation**: Comprehensive tool documentation and examples

### Security
1. **Secrets Management**: Use secure environment variable storage
2. **Access Control**: Implement appropriate authentication and authorization
3. **Input Validation**: Validate all inputs from AI Assistant/Junie
4. **Audit Logging**: Log all tool invocations for security monitoring

## Advanced Configuration

### Custom Server Implementation
```python
# Example Python MCP server
from mcp import Server
import asyncio

server = Server("custom-tools")

@server.tool("analyze_code")
async def analyze_code(file_path: str) -> str:
    # Custom code analysis logic
    return f"Analysis results for {file_path}"

async def main():
    await server.serve_stdio()

if __name__ == "__main__":
    asyncio.run(main())
```

### Multi-Server Orchestration
```json
{
  "name": "orchestrator",
  "command": "node",
  "args": ["orchestrator.js"],
  "env": {
    "UPSTREAM_SERVERS": "server1:8080,server2:8081",
    "LOAD_BALANCE": "round_robin"
  },
  "transport": "stdio"
}
```

## Integration with JetBrains Ecosystem

### Plugin Development
- Use JetBrains Platform SDK for plugin integration
- Implement MCP server communication protocols
- Follow JetBrains UI/UX guidelines

### IDE API Integration
- Access project structure through IDE APIs
- Integrate with version control systems
- Utilize built-in code analysis tools

### Team Collaboration
- Share server configurations through version control
- Document team-specific server requirements
- Establish server maintenance responsibilities

This specification provides comprehensive guidance for configuring and managing MCP servers in JetBrains Junie environments, enabling powerful AI-assisted development workflows.


# JetBrains Junie Guidelines and Rules Configuration Specification

## Overview
JetBrains Junie is an autonomous AI coding agent integrated into JetBrains IDEs. It uses project-level configuration files to understand project context, coding standards, and operational constraints.

## File Placement and Structure

### 1. .junie/guidelines.md (Primary Configuration)
- **Location**: `.junie/guidelines.md` in project root
- **Purpose**: The "brain" of Junie - persistent, version-controlled context read on every task
- **Visibility**: Committed to version control for team consistency

### Hidden Directory Structure
```
<project-root>/
└── .junie/
    └── guidelines.md    # Main configuration file
```

## File Format

### Basic Structure
The guidelines file uses plain Markdown format with no special frontmatter or YAML headers required.

```markdown
# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Tailwind CSS
- Testing: Jest + React Testing Library

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types for object shapes
3. Use meaningful variable names
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services

## Code Examples
```typescript
// Preferred component structure
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
```

```

## Content Structure Recommendations

### Essential Sections
1. **Tech Stack**: Framework versions, core libraries, architecture choices
2. **Coding Standards**: Style rules, naming conventions, quality requirements
3. **Testing Strategy**: Testing frameworks, coverage requirements, test patterns
4. **Code Examples**: Preferred patterns and implementations
5. **Antipatterns**: What to avoid, deprecated practices
6. **Build & Deployment**: Commands, processes, environments

### Advanced Sections
- **Security Guidelines**: Security requirements, sensitive data handling
- **Performance Considerations**: Optimization guidelines, performance budgets
- **Documentation Standards**: Comment styles, README requirements
- **Git Workflow**: Branch naming, commit message format, PR guidelines
- **Dependencies**: Approved libraries, version management policies

## Creation Methods

### 1. Manual Creation
- Use "Create project guidelines" from the IDE prompt panel
- Create the `.junie/` directory and `guidelines.md` file manually
- Copy content from team templates or existing projects

### 2. Auto-generation
Ask Junie to explore and create guidelines:
```
"Explore the project and create guidelines"
```

**Process**:
1. Junie scans the project for 30-90 seconds
2. Runs harmless shell commands (ls, find, etc.) to understand structure
3. Analyzes code patterns, dependencies, and configuration files
4. Generates comprehensive guidelines file for review and editing

### 3. Template Library
- Use snippets from JetBrains' open-source guidelines catalog
- Repository: [JetBrains/junie-guidelines](https://github.com/JetBrains/junie-guidelines)
- Copy and adapt relevant sections for your project

## Operating Modes and Rule Application

### Ask Mode
- **Behavior**: Chat-style Q&A interaction
- **Guidelines Usage**: Always injected into context
- **File Access**: Respects .aiignore restrictions
- **Safety**: Manual approval for sensitive operations

### Code Mode
- **Behavior**: Autonomous multi-step execution
- **Guidelines Usage**: Continuously referenced during execution
- **Permission Flow**:
  1. **Brave Mode ON** → Full trust, no confirmations
  2. **Command in Allowlist** → Auto-run without confirmation
  3. **Default** → Explicit confirmation dialog

## Integration with IDE Settings

### IDE-Level Configuration
Access via: **Settings | Tools | Junie | Project Settings**

#### Writable Area Restriction
- Scope Junie's write access to specific subdirectories
- Files outside the writable area require explicit approval
- Useful for protecting critical configuration or production code

#### Action Allowlist
- **Path**: Settings | Tools | Junie | Action Allowlist
- **Purpose**: White-list CLI commands using regular expressions
- **Effect**: Matching commands run unattended even without Brave Mode

**Example Patterns**:
```regex
# Allow all npm scripts
^npm run \w+$

# Allow Laravel artisan commands
^\Qphp artisan \E\S+(?:\s+(?:[-\w:=]+|"[^"]*"|'[^']*'))*$

# Allow git status and log commands
^git (status|log).*$

# Allow test runners
^(npm test|yarn test|pnpm test)$
```

### Brave Mode
- **Location**: Checkbox in Code mode toolbar
- **Effect**: Junie can run any terminal command and access any file without confirmation
- **Use Case**: Development sandboxes, experimental branches
- **Caution**: Use only in controlled environments

## Best Practices

### Content Guidelines
1. **Keep it concise**: Focus on essential project-specific information
2. **Be specific**: Provide concrete examples rather than vague principles
3. **Include examples**: Show preferred code patterns and structures
4. **Version control**: Commit guidelines to share with team members
5. **Regular updates**: Keep guidelines current with project evolution

### Security Considerations
1. **No secrets**: Never include API keys, passwords, or sensitive data
2. **Safe commands**: Only allowlist idempotent, safe CLI commands
3. **Review changes**: Carefully review Junie's first commits and PRs
4. **Gradual trust**: Start with restrictive settings, gradually relax as confidence builds

### Team Workflow
1. **Early creation**: Establish guidelines.md early in project lifecycle
2. **Team review**: Have team members review and approve initial guidelines
3. **Consistent format**: Use standardized template across projects
4. **Regular maintenance**: Update guidelines as project evolves
5. **Documentation**: Document custom allowlist patterns and their purposes

### Content Organization
```markdown
# Project Guidelines

## Quick Reference
- Primary language: TypeScript
- Framework: Next.js 14
- Package manager: pnpm

## Development Workflow
### Setup Commands
```bash
pnpm install
pnpm dev
```

### Testing
```bash
pnpm test
pnpm test:watch
```

### Build
```bash
pnpm build
pnpm start
```

## Coding Standards
### File Organization
- Components: `src/components/`
- Pages: `src/pages/`
- Utils: `src/lib/`
- Types: `src/types/`

### Naming Conventions
- Components: PascalCase (`UserProfile.tsx`)
- Files: kebab-case (`user-profile.utils.ts`)
- Variables: camelCase (`userName`)
- Constants: UPPER_SNAKE_CASE (`API_BASE_URL`)

### Code Style
1. Use TypeScript strict mode
2. Prefer named exports over default exports
3. Use explicit return types for functions
4. Write descriptive variable names

## Architecture
### State Management
- Use React hooks for local state
- Use Zustand for global state
- Avoid prop drilling beyond 2 levels

### API Integration
- Use React Query for data fetching
- Implement proper error boundaries
- Handle loading states consistently

## Testing Requirements
- Unit tests for all business logic
- Integration tests for API endpoints
- Component tests for complex UI logic
- Minimum 80% code coverage
```

## Maintenance and Updates

### Regular Review Points
1. **After major refactoring**: Update patterns and examples
2. **New team members**: Review guidelines for clarity and completeness
3. **Technology updates**: Reflect framework/library version changes
4. **Process changes**: Update workflow and command examples

### Monitoring Effectiveness
- Review Junie's code generation quality
- Track adherence to established patterns
- Collect team feedback on guideline clarity
- Measure reduction in review comments

## Integration with Other Tools

### Version Control
- Commit `.junie/guidelines.md` to repository
- Include in PR reviews when guidelines change
- Use semantic versioning for major guideline updates

### CI/CD Integration
- Reference guidelines in PR templates
- Automate guideline compliance checks
- Include guideline validation in CI pipeline

### Documentation Systems
- Link to external documentation where appropriate
- Keep internal guidelines focused on Junie-specific needs
- Avoid duplicating information available in README or docs

## Troubleshooting

### Common Issues
1. **Guidelines not applied**: Check file location and syntax
2. **Overly verbose output**: Reduce guideline length, increase specificity
3. **Inconsistent behavior**: Review conflicting rules or unclear instructions
4. **Performance issues**: Large guidelines files can slow context loading

### Optimization Tips
- Keep guidelines under 2000 words
- Use bullet points and numbered lists for clarity
- Include specific code examples rather than abstract principles
- Remove outdated or conflicting information regularly