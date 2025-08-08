# rulesync

[![CI](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml/badge.svg)](https://github.com/dyoshikawa/rulesync/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/rulesync.svg)](https://www.npmjs.com/package/rulesync)

A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files (`.rulesync/*.md`). Also imports existing AI tool configurations into the unified format.

**English** | [日本語](./README.ja.md)

## Supported Tools

rulesync supports both **generation** and **import** for the following AI development tools:

- **GitHub Copilot Custom Instructions** (`.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`)
- **Cursor Project Rules** (`.cursor/rules/*.mdc` + `.cursorrules`) 
- **Cline Rules** (`.clinerules/*.md` + `.cline/instructions.md`)
- **Claude Code Memory** (`./CLAUDE.md` + `.claude/memories/*.md`)
- **OpenAI Codex CLI** (`codex.md` + `.codex/mcp-config.json` + `.codexignore`)
- **AugmentCode Rules** (`.augment/rules/*.md`)
- **Roo Code Rules** (`.roo/rules/*.md` + `.roo/instructions.md`)
- **Gemini CLI** (`GEMINI.md` + `.gemini/memories/*.md`)
- **JetBrains Junie Guidelines** (`.junie/guidelines.md`)
- **Kiro IDE Custom Steering Documents** (`.kiro/steering/*.md`) + **AI Ignore Files** (`.aiignore`)
- **Windsurf AI Code Editor** (`.windsurf/rules/*.md` + `.windsurf/mcp.json` + `.codeiumignore`)

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
   npx rulesync init
   ```

2. **Edit the generated rule files** in `.rulesync/` directory to match your project needs
   
   Or add new rule files:
   ```bash
   npx rulesync add my-custom-rules
   ```

3. **Generate tool-specific configuration files:**
   ```bash
   npx rulesync generate
   ```

4. **Optional: Add generated files to .gitignore:**
   ```bash
   npx rulesync gitignore
   ```

### Existing Project with AI Tool Configurations

If you already have AI tool configurations, you can import them into rulesync format:

1. **Import existing configurations:**
   ```bash
   # Import from specific tools (only one tool can be specified at a time)
   npx rulesync import --claudecode  # From CLAUDE.md and .claude/memories/*.md
   npx rulesync import --cursor      # From .cursorrules and .cursor/rules/*.mdc
   npx rulesync import --copilot     # From .github/copilot-instructions.md
   npx rulesync import --cline       # From .cline/instructions.md
   npx rulesync import --augmentcode        # From .augment/rules/*.md
   npx rulesync import --augmentcode-legacy # From .augment-guidelines (legacy format)
   npx rulesync import --roo                # From .roo/instructions.md
   npx rulesync import --geminicli   # From GEMINI.md and .gemini/memories/*.md
   npx rulesync import --junie       # From .junie/guidelines.md
   npx rulesync import --windsurf    # From .windsurf/rules/*.md
   ```

2. **Review and edit** the imported rules in `.rulesync/` directory

3. **Generate unified configurations:**
   ```bash
   npx rulesync generate
   ```

That's it! Your AI coding assistants will now use the generated configuration files automatically.

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
- OpenAI Codex CLI for GPT-4 powered development
- Gemini CLI for intelligent code analysis
- JetBrains Junie for autonomous AI coding
- Windsurf for comprehensive AI-assisted editing with Cascade AI

### 🔓 **No Vendor Lock-in**
Avoid vendor lock-in completely. If you decide to stop using rulesync, you can continue using the generated rule files (`.github/instructions/`, `.cursor/rules/`, `.clinerules/`, `CLAUDE.md`, `codex.md`, `GEMINI.md`, `.junie/guidelines.md`, `.windsurf/rules/`, etc.) as-is.

### 🎯 **Consistency Across Tools**
Apply consistent rules across all AI tools, improving code quality and development experience for the entire team.

## Kiro IDE Integration

### Custom Steering Documents and AI Ignore Files

rulesync supports **Custom Steering Documents** and **AI Ignore Files** for Kiro IDE, complementing Kiro's built-in project management system.

**Important**: rulesync does NOT generate the core steering files (`product.md`, `structure.md`, `tech.md`) as these are better managed directly by Kiro IDE itself. Instead, rulesync focuses on generating additional custom steering documents and AI-specific ignore files.

### What rulesync provides for Kiro:
- **Custom steering documents**: Additional `.md` files in `.kiro/steering/` directory
- **AI ignore files**: `.aiignore` file for excluding files from AI access
- **Project-specific rules**: Team coding standards, security guidelines, deployment processes
- **Rule synchronization**: Keep custom rules consistent across team members
- **Intelligent pattern extraction**: Automatically identifies AI-sensitive patterns from rule globs

### AI Ignore File Features:
- **Security-first exclusions**: Automatically excludes sensitive files (`.pem`, `.key`, `.env*`)
- **Data file exclusions**: Excludes large data files that might confuse AI (`.csv`, `.sqlite`, `.zip`)
- **Sensitive documentation**: Excludes internal documentation and confidential directories
- **Pattern-based exclusions**: Analyzes rule globs to identify AI-sensitive patterns
- **Explicit ignore patterns**: Supports manual ignore patterns in rule content (`# IGNORE:`, `# aiignore:`)

### What Kiro IDE handles directly:
- **Core steering files**: `product.md` (user requirements), `structure.md` (architecture), `tech.md` (tech stack)
- **Spec management**: Feature specifications in `.kiro/specs/`
- **Agent hooks**: Automated context application

This division of responsibility ensures that rulesync enhances Kiro's capabilities without duplicating its core functionality.

## OpenAI Codex CLI Integration

### Hierarchical Memory System

rulesync supports **OpenAI Codex CLI**'s hierarchical memory system, which provides persistent context and project-specific rules to GPT-4 powered development workflows.

**Key Features**:
- **Hierarchical Instructions**: Global user instructions → Project-level instructions → Directory-specific instructions
- **MCP Integration**: Model Context Protocol support through wrapper servers for extended functionality  
- **GPT-4 Models**: Support for GPT-4, GPT-4 Turbo, o1-mini, and other OpenAI models
- **Plain Markdown Format**: Clean, readable instruction files without complex frontmatter
- **Community Ignore Support**: Optional `.codexignore` file for excluding sensitive files from AI access

### File Structure

rulesync generates the following files for OpenAI Codex CLI:

- **`codex.md`**: Main project-level instructions (generated from root rules)
- **`<filename>.md`**: Additional instruction files (generated from non-root rules)
- **`.codex/mcp-config.json`**: MCP server configuration for wrapper servers
- **`.codexignore`**: Optional ignore file for community tools and enhanced privacy

### Usage with OpenAI Models

OpenAI Codex CLI works with various OpenAI models:
- **GPT-4**: Best for complex reasoning and architecture decisions
- **GPT-4 Turbo**: Optimized for performance and cost efficiency
- **o1-mini**: Specialized for coding tasks and problem-solving
- **GPT-4o-mini**: Balanced performance for everyday development tasks

The hierarchical memory system ensures consistent coding standards and project context across all model interactions.

### Example Usage

Generate OpenAI Codex CLI configuration files:

```bash
# Generate only for OpenAI Codex CLI
npx rulesync generate --codexcli

# Generate with MCP configuration for wrapper servers
npx rulesync generate --codexcli --verbose

# Generate in specific directory (useful for monorepos)
npx rulesync generate --codexcli --base-dir ./packages/frontend
```

This will create:
- `codex.md` with your project-level instructions
- Additional `.md` files for specific rule categories  
- `.codex/mcp-config.json` for MCP wrapper server integration
- `.codexignore` for enhanced privacy control (if `.rulesyncignore` exists)

## Windsurf AI Code Editor Integration

### Comprehensive AI-Assisted Development

rulesync provides full integration with **Windsurf AI Code Editor**, supporting its complete ecosystem of features including rules/memories, MCP servers, and ignore file patterns.

**Key Features**:
- **Unified Rule System**: Supports both workspace rules and global rules with automatic memory integration
- **Cascade AI Enhancement**: Provides persistent context to Windsurf's Cascade AI for better code understanding
- **MCP Integration**: Model Context Protocol support for extended functionality through external services
- **Privacy Controls**: Advanced ignore file generation for sensitive data protection

### File Structure

rulesync generates the following files for Windsurf:

- **`.windsurf/rules/*.md`**: Project-specific rules (generated from both root and detail rules)
- **`.windsurf/mcp.json`**: MCP server configuration for external tool integration  
- **`.codeiumignore`**: Ignore file for excluding sensitive files from Cascade AI analysis

### Rule Integration Options

Windsurf supports multiple rule placement strategies:

#### Directory Variant (Recommended)
- **Location**: `.windsurf/rules/` directory
- **Files**: Multiple Markdown files for organized rule categorization
- **Benefits**: Better organization, team collaboration, version control friendly

#### Single-File Alternative  
- **Location**: `.windsurf-rules` file at project root
- **Format**: Single Markdown file with all rules
- **Use Case**: Simple projects or minimal rule sets

### Cascade AI Memory System

Windsurf's Cascade AI automatically integrates with both:
- **Workspace Rules**: Project-specific guidelines in `.windsurf/rules/`
- **Auto-generated Memories**: Context learned from development patterns
- **Global Rules**: User-wide preferences (not managed by rulesync)

The combination provides comprehensive context for AI-assisted development.

### Example Usage

Generate Windsurf configuration files:

```bash
# Generate only for Windsurf
npx rulesync generate --windsurf

# Generate with verbose output
npx rulesync generate --windsurf --verbose

# Generate in specific directory (useful for monorepos)
npx rulesync generate --windsurf --base-dir ./packages/frontend
```

This will create:
- `.windsurf/rules/*.md` with your project rules organized by category
- `.windsurf/mcp.json` for MCP server integration
- `.codeiumignore` for enhanced privacy control (if `.rulesyncignore` exists)

## Claude Code Integration

### Creating Custom Slash Commands

Instead of using Claude Code's built-in `/init` command, we recommend creating a custom slash command specifically for rulesync.

Refer to the [Claude Code slash commands documentation](https://docs.anthropic.com/en/docs/claude-code/slash-commands) and add the following custom command:

**`.claude/commands/init-rulesync.md`**

```markdown
Analyze this project's codebase and update .rulesync/overview.md files as needed.

Please ensure the following frontmatter is defined in .rulesync/overview.md:

---
root: true | false               # Required: Rule level (true for overview, false for details)
targets: ["*"]                   # Required: Target tools (* = all, or specific tools)
description: "" # Required: Rule description
globs: ["**/*"]                  # Required: File patterns
cursorRuleType: "always"         # Optional: Cursor-specific rule type (always, manual, specificFiles, intelligently)
---

In .rulesync/overview.md, root should be set to true. Please write an appropriate description in the description field.
```

### Integration Benefits

- **Project-Specific Initialization**: Optimized rule configuration for each project
- **Automatic Rule Updates**: Rules adapt to project changes automatically
- **Team Standardization**: All members use the same rule set
- **Continuous Improvement**: Rules evolve with project growth

## Usage

### 1. Initialize

```bash
npx rulesync init
```

This creates a `.rulesync/` directory with sample rule files.

### 2. Edit Rule Files

Define metadata in front matter for each Markdown file in the `.rulesync/` directory. See the [Example Files](#example-files) section below for detailed examples.

### Rule Levels

rulesync uses a two-level rule system:

- **root: true**: Project-wide overview and policies
  - Only **one** root file is allowed per project
  - Contains high-level guidelines and project context
- **root: false**: Specific implementation rules and detailed guidelines
  - Multiple non-root files are allowed
  - Contains specific coding rules, naming conventions, etc.

#### Tool-Specific Behavior

Each AI tool handles rule levels differently:

| Tool | Root Rules | Non-Root Rules | Special Behavior |
|------|------------|----------------|------------------|
| **Claude Code** | `./CLAUDE.md` | `.claude/memories/*.md` | CLAUDE.md includes `@filename` references to detail files |
| **Cursor** | `cursorRuleType: always` | `cursorRuleType: specificFiles` (with globs)<br>`cursorRuleType: intelligently` (with description)<br>`cursorRuleType: manual` (default) | Advanced rule type system based on content analysis |
| **GitHub Copilot** | Standard format | Standard format | All rules use same format with frontmatter |
| **Cline** | Standard format | Standard format | All rules use plain Markdown format |
| **Roo Code** | Standard format | Standard format | All rules use plain Markdown format with description header |
| **Gemini CLI** | `GEMINI.md` | `.gemini/memories/*.md` | GEMINI.md includes `@filename` references to memory files |

### 3. Generate Configuration Files

```bash
# Generate for all tools
npx rulesync generate

# Generate for specific tools
npx rulesync generate --copilot
npx rulesync generate --cursor  
npx rulesync generate --cline
npx rulesync generate --claudecode
npx rulesync generate --codexcli
npx rulesync generate --augmentcode
npx rulesync generate --roo
npx rulesync generate --geminicli
npx rulesync generate --junie
npx rulesync generate --kiro
npx rulesync generate --windsurf

# Clean build (delete existing files first)
npx rulesync generate --delete

# Clean build for specific tools
npx rulesync generate --copilot --cursor --codexcli --windsurf --delete

# Verbose output
npx rulesync generate --verbose
npx rulesync generate --delete --verbose

# Generate in specific base directories (monorepo support)
npx rulesync generate --base-dir ./packages/frontend
npx rulesync generate --base-dir ./packages/frontend,./packages/backend
npx rulesync generate --base-dir ./apps/web,./apps/api,./packages/shared
```

#### Generate Options

- `--delete`: Remove all existing generated files before creating new ones
- `--verbose`: Show detailed output during generation process
- `--copilot`, `--cursor`, `--cline`, `--claudecode`, `--codexcli`, `--augmentcode`, `--roo`, `--geminicli`, `--junie`, `--kiro`, `--windsurf`: Generate only for specified tools
- `--base-dir <paths>`: Generate configuration files in specified base directories (comma-separated for multiple paths). Useful for monorepo setups where you want to generate tool-specific configurations in different project directories.
- `--config <path>`: Use a specific configuration file
- `--no-config`: Disable configuration file loading

### Configuration Files

rulesync supports configuration files to avoid repetitive command-line arguments. The configuration is loaded from (in order of precedence):

1. Path specified with `--config` flag
2. `rulesync.jsonc` (JSONC format with comments)
3. `rulesync.ts` (TypeScript format)
4. `rulesync.config.ts`
5. `rulesync.config.jsonc`
6. `package.json` (in a `"rulesync"` field)

#### Configuration File Examples

**JSONC format (`rulesync.jsonc`):**
```jsonc
{
  // List of tools to generate configurations for
  "targets": ["copilot", "cursor", "claudecode", "codexcli", "windsurf"],
  
  // Tools to exclude from generation (overrides targets)
  "exclude": ["roo"],
  
  // Custom output paths for specific tools
  "outputPaths": {
    "copilot": ".github/copilot-instructions.md"
  },
  
  // Base directory or directories for generation
  "baseDir": "./packages",
  
  // Delete existing files before generating
  "delete": false,
  
  // Enable verbose output
  "verbose": true,
  
  // Directory containing rule files
  "aiRulesDir": ".rulesync",
  
  // Watch configuration
  "watch": {
    "enabled": false,
    "interval": 1000,
    "ignore": ["node_modules/**", ".git/**", "dist/**", "build/**"]
  }
}
```

**TypeScript format (`rulesync.ts`):**
```typescript
import type { ConfigOptions } from "rulesync";

const config: ConfigOptions = {
  targets: ["copilot", "cursor", "claudecode", "codexcli", "windsurf"],
  exclude: ["roo"],
  outputPaths: {
    copilot: ".github/copilot-instructions.md"
  },
  baseDir: "./packages",
  delete: false,
  verbose: true
};

export default config;
```

#### Configuration Options

- `targets`: Array of tools to generate configurations for (overrides default targets)
- `exclude`: Array of tools to exclude from generation
- `outputPaths`: Custom output paths for specific tools
- `baseDir`: Base directory or array of directories for generation
- `delete`: Delete existing files before generating (default: false)
- `verbose`: Enable verbose output (default: false)
- `aiRulesDir`: Directory containing rule files (default: ".rulesync")
- `watch`: Watch configuration with `enabled`, `interval`, and `ignore` options
  - `enabled`: Enable file watching (default: false)
  - `interval`: Watch interval in milliseconds (default: 1000)
  - `ignore`: Array of patterns to ignore during watching

#### Managing Configuration

```bash
# Show current configuration
npx rulesync config

# Initialize a configuration file
npx rulesync config --init

# Initialize with specific format
npx rulesync config --init --format jsonc  # Default, supports comments
npx rulesync config --init --format ts     # TypeScript with type safety
```

### 4. Import Existing Configurations

If you already have AI tool configurations in your project, you can import them to rulesync format:

```bash
# Import from existing AI tool configurations
npx rulesync import --claudecode # Import from CLAUDE.md and .claude/memories/*.md
npx rulesync import --cursor     # Import from .cursorrules and .cursor/rules/*.md
npx rulesync import --copilot    # Import from .github/copilot-instructions.md and .github/instructions/*.instructions.md
npx rulesync import --cline      # Import from .cline/instructions.md
npx rulesync import --augmentcode # Import from .augment/rules/*.md
npx rulesync import --roo        # Import from .roo/instructions.md
npx rulesync import --geminicli  # Import from GEMINI.md and .gemini/memories/*.md
npx rulesync import --junie      # Import from .junie/guidelines.md
npx rulesync import --windsurf   # Import from .windsurf/rules/*.md

# Import each tool individually
npx rulesync import --claudecode
npx rulesync import --cursor
npx rulesync import --copilot

# Verbose output during import
npx rulesync import --claudecode --verbose
```

The import command will:
- Parse existing configuration files from each AI tool using custom parsers
- Convert them to rulesync format with appropriate frontmatter metadata
- Create new `.rulesync/*.md` files with imported content and proper rule categorization
- Use tool-specific prefixes to avoid filename conflicts (e.g., `claudecode-overview.md`, `cursor-custom-rules.md`)
- Generate unique filenames if conflicts occur
- Support complex formats like Cursor's MDC files with YAML frontmatter
- Handle multiple file imports (e.g., all files from `.claude/memories/` directory)

### Cursor Import Details

When importing from Cursor, the following four rule types are automatically identified:

1. **always** (`cursorRuleType: always`)
   - Condition: `alwaysApply: true` is set
   - Conversion: Imported as root rule (`root: false`), with `globs: ["**/*"]` set

2. **manual** (`cursorRuleType: manual`)
   - Condition: empty description + empty globs + `alwaysApply: false`
   - Conversion: Imported with empty globs patterns (manual application rule)

3. **specificFiles** (`cursorRuleType: specificFiles`)
   - Condition: globs specified (regardless of description)
   - Conversion: Specified globs patterns preserved as array, description set to empty string

4. **intelligently** (`cursorRuleType: intelligently`)
   - Condition: description specified + empty globs
   - Conversion: Description preserved, empty globs patterns set

#### Edge Case Handling
- **Non-empty description + non-empty globs**: Processed as `specificFiles` (globs patterns take priority)
- **No matching conditions**: Processed as `manual` (default)

#### Supported Files
- `.cursorrules` (legacy format)
- `.cursor/rules/*.mdc` (modern MDC format)
- `.cursorignore` (ignore patterns)
- `.cursor/mcp.json` (MCP server configuration)

### 5. Other Commands

```bash
# Initialize project with sample files
npx rulesync init

# Add a new rule file
npx rulesync add <filename>
npx rulesync add typescript-rules
npx rulesync add security.md  # .md extension is automatically handled

# Validate rule files
npx rulesync validate

# Check current status  
npx rulesync status

# Watch files and auto-generate
npx rulesync watch

# Add generated files to .gitignore
npx rulesync gitignore

# Show or manage configuration
npx rulesync config
npx rulesync config --init  # Create configuration file
```

## Configuration File Structure

```
.rulesync/
├── overview.md          # Project overview (root: true, only one)
├── coding-rules.md      # Coding rules (root: false)
├── naming-conventions.md # Naming conventions (root: false)
├── architecture.md      # Architecture guidelines (root: false)  
├── security.md          # Security rules (root: false)
└── custom.md           # Project-specific rules (root: false)
```

### Excluding Files with .rulesyncignore

You can exclude specific rule files from being processed by creating a `.rulesyncignore` file in your project root. This file uses gitignore-style patterns.

Example `.rulesyncignore`:
```
# Ignore test rule files
**/*.test.md

# Ignore temporary files
tmp/**/*

# Ignore draft rules
draft-*.md
*-draft.md
```

When `.rulesyncignore` exists, rulesync will:
1. Skip matching files during rule processing
2. Generate tool-specific ignore files:
   - `.cursorignore` for Cursor
   - `.clineignore` for Cline
   - `.rooignore` for Roo Code
   - `.copilotignore` for GitHub Copilot (community tools)
   - `.aiexclude` for Gemini CLI
   - `.aiignore` for Kiro IDE
   - `.codeiumignore` for Windsurf
   - Update `.claude/settings.json` permissions.deny with `Read()` rules for Claude Code

### Frontmatter Schema

Each rule file must include frontmatter with the following fields:

```yaml
---
root: true | false               # Required: Rule level (true for overview, false for details)
targets: ["*"]                   # Required: Target tools (* = all, or specific tools)
description: "Brief description" # Required: Rule description
globs: ["**/*"]                  # Required: File patterns (array format)
cursorRuleType: "always"         # Optional: Cursor-specific rule type (always, manual, specificFiles, intelligently)
---
```

#### cursorRuleType Field (Optional)

Additional metadata field for Cursor tool:

- **`always`**: Rules applied to the entire project constantly
- **`manual`**: Rules applied manually (default)
- **`specificFiles`**: Rules automatically applied to specific file patterns
- **`intelligently`**: Rules applied by AI judgment

### Example Files

**Root file** (`.rulesync/overview.md`):
```markdown
---
root: true
targets: ["*"]
description: "Project overview and development philosophy"
globs: ["src/**/*.ts"]
---

# Project Development Guidelines

This project follows TypeScript-first development with clean architecture principles.
```

**Non-root file** (`.rulesync/coding-rules.md`):
```markdown
---
root: false
targets: ["copilot", "cursor", "roo"]
description: "TypeScript coding standards"
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Coding Rules

- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use meaningful variable names
```

## Generated Configuration Files

| Tool | Output Path | Format | Rule Level Handling |
|------|------------|--------|-------------------|
| **GitHub Copilot** | `.github/instructions/*.instructions.md` | Front Matter + Markdown | Both levels use same format |
| **Cursor** | `.cursor/rules/*.mdc` | MDC (YAML header + Markdown) | Root: `cursorRuleType: always`<br>Non-root: `cursorRuleType: specificFiles` (with globs)<br>Non-root: `cursorRuleType: intelligently` (with description)<br>Non-root: `cursorRuleType: manual` (default) |
| **Cline** | `.clinerules/*.md` | Plain Markdown | Both levels use same format |
| **Claude Code** | `./CLAUDE.md` (root)<br>`.claude/memories/*.md` (non-root) | Plain Markdown | Root goes to CLAUDE.md<br>Non-root go to separate memory files<br>CLAUDE.md includes `@filename` references |
| **OpenAI Codex CLI** | `codex.md` (root)<br>`<filename>.md` (non-root) | Plain Markdown | Root goes to codex.md<br>Non-root go to separate instruction files<br>Hierarchical memory system |
| **AugmentCode** | `.augment/rules/*.md` | Markdown with YAML frontmatter | Root: `type: always`<br>Non-root: `type: auto` (with description) or `type: manual` (default) |
| **Roo Code** | `.roo/rules/*.md` | Plain Markdown | Both levels use same format with description header |
| **Gemini CLI** | `GEMINI.md` (root)<br>`.gemini/memories/*.md` (non-root) | Plain Markdown | Root goes to GEMINI.md<br>Non-root go to separate memory files<br>GEMINI.md includes `@filename` references |
| **JetBrains Junie** | `.junie/guidelines.md` | Plain Markdown | All rules combined into single guidelines file |
| **Kiro IDE** | `.kiro/steering/*.md` + `.aiignore` | Plain Markdown + Ignore patterns | Both levels use same format for custom steering docs<br>AI ignore file excludes sensitive patterns |
| **Windsurf** | `.windsurf/rules/*.md` | Plain Markdown | Both levels use same format with auto-generated memory integration |

## Validation

rulesync validates your rule files and provides helpful error messages:

```bash
npx rulesync validate
```

Common validation rules:
- Only one root file (root: true) is allowed per project
- All frontmatter fields are required and properly formatted
- File patterns (globs) use valid syntax
- Target tools are recognized values

## MCP (Model Context Protocol) Support

rulesync can also manage MCP server configurations for supported AI tools. This allows you to configure language servers and other MCP-compatible services once and deploy them across multiple AI coding assistants.

### Supported MCP Tools

- **Claude Code** (`.mcp.json`)
- **GitHub Copilot** (`.vscode/mcp.json`)
- **Cursor** (`.cursor/mcp.json`)
- **Cline** (`.cline/mcp.json`)
- **OpenAI Codex CLI** (`.codex/mcp-config.json`)
- **Gemini CLI** (`.gemini/settings.json`)
- **JetBrains Junie** (`.junie/mcp.json`)
- **Kiro IDE** (`.kiro/mcp.json`)
- **Roo Code** (`.roo/mcp.json`)
- **Windsurf** (`.windsurf/mcp.json`)

### MCP Configuration

Create a `.rulesync/.mcp.json` file in your project:

```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {},
      "targets": ["*"]
    }
  }
}
```

### MCP Configuration Fields

- **`mcpServers`**: Object containing MCP server configurations
  - **`command`**: Executable command for stdio-based servers
  - **`args`**: Command arguments
  - **`url`**: URL for HTTP/SSE-based servers
  - **`env`**: Environment variables to pass to the server
  - **`targets`**: Array of tool names to deploy this server to
    - Use specific tool names: `["claude", "cursor", "copilot"]`
    - Use `["*"]` to deploy to all supported tools
    - If omitted, server is deployed to all tools by default

### Kiro IDE-Specific MCP Fields

For Kiro IDE, you can use additional configuration fields:

- **`kiroAutoApprove`**: Array of tool names to automatically approve without user prompts
- **`kiroAutoBlock`**: Array of tool names to automatically block

Example with Kiro-specific fields:
```json
{
  "mcpServers": {
    "aws-tools": {
      "command": "python",
      "args": ["-m", "aws_mcp_server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1"
      },
      "kiroAutoApprove": ["describe_instances", "list_buckets"],
      "kiroAutoBlock": ["delete_bucket", "terminate_instances"],
      "targets": ["kiro"]
    }
  }
}
```

### Generating MCP Configurations

MCP configurations are generated alongside rule files:

```bash
# Generate both rules and MCP configurations
npx rulesync generate

# Generate only for specific tools
npx rulesync generate --claudecode --cursor --codexcli --junie --kiro --windsurf

# Generate in specific directories (monorepo)
npx rulesync generate --base-dir ./packages/frontend
```

The MCP configurations will be generated in the appropriate locations for each tool, and the tools will automatically load them when started.

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

For development setup and contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).