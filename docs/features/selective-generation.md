# Selective Generation with Features

## Overview

The `--features` option (introduced in v0.63.0) allows you to generate only specific types of files, making rulesync faster and more flexible. Instead of always generating all possible files, you can now choose exactly what you need.

## Feature Types

rulesync supports four distinct feature types:

### 1. `rules` - Core AI Assistant Rules
- **What it generates**: Main rule files and instructions for AI assistants
- **File examples**: `CLAUDE.md`, `.cursor/rules/*.mdc`, `.github/instructions/*.md`
- **Support**: All 19 AI tools support rule generation
- **Use case**: Essential configuration files for AI behavior

### 2. `commands` - Custom Slash Commands
- **What it generates**: Custom command definitions for AI tools
- **File examples**: `.claude/commands/*.md`, `.gemini/commands/*.md`
- **Support**: Currently supported by Claude Code, Cursor, Cline, Gemini CLI, Roo Code
- **Use case**: Reusable commands and shortcuts for AI interactions

### 3. `mcp` - Model Context Protocol Configuration
- **What it generates**: MCP server configurations for external tool integration
- **File examples**: `.mcp.json`, `.cursor/mcp.json`, `.codex/mcp-config.json`
- **Support**: Tools with MCP integration (Amazon Q CLI, Claude Code, Cursor, etc.)
- **Use case**: Integration with external services and APIs

### 4. `ignore` - AI Access Control Files
- **What it generates**: Ignore files to control which files AI can access
- **File examples**: `.cursorignore`, `.clineignore`, `.aiignore`
- **Support**: Most tools (except permission-based tools like OpenCode)
- **Use case**: Security and privacy control for AI file access

## Usage Examples

### Basic Usage

```bash
# Generate only rule files (fastest option)
npx rulesync generate --targets * --features rules

# Generate rules and MCP configurations
npx rulesync generate --targets * --features rules,mcp

# Generate all features explicitly
npx rulesync generate --targets * --features *
```

### Tool-Specific Examples

```bash
# Generate only rules for specific tools
npx rulesync generate --targets copilot,cursor --features rules

# Generate rules and commands for command-capable tools
npx rulesync generate --targets claudecode,cursor,cline --features rules,commands

# Generate MCP configurations for MCP-capable tools
npx rulesync generate --targets amazonqcli,claudecode --features mcp

# Generate ignore files for privacy-focused setup
npx rulesync generate --targets * --features rules,ignore
```

### Performance-Focused Examples

```bash
# Minimal generation for development
npx rulesync generate --targets cursor --features rules

# Quick rule updates without regenerating MCP configs
npx rulesync generate --targets * --features rules

# Generate only ignore files after security review
npx rulesync generate --targets * --features ignore
```

## Configuration File Support

Features can also be specified in configuration files:

### rulesync.jsonc
```jsonc
{
  "features": ["rules", "mcp"],
  "defaultTargets": ["*"]
}
```

### rulesync.config.ts
```typescript
import { defineConfig } from "rulesync";

export default defineConfig({
  features: ["rules", "commands"],
  defaultTargets: ["claudecode", "cursor", "cline"]
});
```

### package.json
```json
{
  "rulesync": {
    "features": "*",
    "defaultTargets": ["*"]
  }
}
```

## Backward Compatibility

### Default Behavior
When `--features` is not specified:
- **Behavior**: Generates all features (equivalent to `--features *`)
- **Warning**: Shows a warning encouraging explicit feature specification
- **Future**: This behavior may change in future versions to require explicit specification

### Migration Examples

```bash
# Old command (still works, shows warning)
npx rulesync generate --targets *

# New explicit command (recommended)
npx rulesync generate --targets * --features *

# Selective generation (new capability)
npx rulesync generate --targets * --features rules,mcp
```

## Feature Compatibility Matrix

| Tool | Rules | Commands | MCP | Ignore |
|------|-------|----------|-----|--------|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ |
| **Cursor** | ✅ | ✅ | ✅ | ✅ |
| **GitHub Copilot** | ✅ | ❌ | ❌ | ✅ |
| **Cline** | ✅ | ✅ | ✅ | ✅ |
| **Amazon Q CLI** | ✅ | ❌* | ✅ | ❌* |
| **OpenCode** | ✅ | ❌ | ✅ | ❌** |
| **Codex CLI** | ✅ | ❌ | ✅ | ✅ |
| **AugmentCode** | ✅ | ❌ | ❌ | ✅ |
| **Roo Code** | ✅ | ✅ | ✅ | ✅ |
| **Gemini CLI** | ✅ | ✅ | ✅ | ✅ |
| **Qwen Code** | ✅ | ❌ | ✅ | ❌*** |
| **JetBrains Junie** | ✅ | ❌ | ✅ | ✅ |
| **Kiro IDE** | ✅ | ❌ | ✅ | ✅ |
| **Windsurf** | ✅ | ❌ | ✅ | ✅ |
| **AgentsMd** | ✅ | ❌ | ❌ | ❌ |

**Notes:**
- *Amazon Q CLI has built-in commands, doesn't need custom command generation
- **OpenCode uses permission-based configuration instead of ignore files
- ***Qwen Code uses git-aware filtering instead of traditional ignore files

## Error Handling and Validation

### Invalid Features
```bash
# Error: Invalid feature type
npx rulesync generate --targets * --features invalid-feature
# Error: Invalid feature types: invalid-feature. Valid features are: rules, commands, mcp, ignore

# Error: Cannot mix wildcard with specific features
npx rulesync generate --targets * --features *,rules
# Error: cannot mix * with specific features
```

### Feature-Tool Compatibility
```bash
# Warning: Tool doesn't support requested feature
npx rulesync generate --targets copilot --features commands
# Warning: GitHub Copilot does not support commands feature, skipping
```

## Development Workflow Integration

### Package.json Scripts
```json
{
  "scripts": {
    "rules:all": "rulesync generate --targets * --features *",
    "rules:core": "rulesync generate --targets * --features rules",
    "rules:dev": "rulesync generate --targets cursor,cline --features rules,commands",
    "rules:mcp": "rulesync generate --targets * --features mcp",
    "rules:security": "rulesync generate --targets * --features ignore"
  }
}
```

### CI/CD Integration
```yaml
# .github/workflows/rulesync.yml
- name: Generate core rules only
  run: npx rulesync generate --targets * --features rules

- name: Validate all features
  run: |
    npx rulesync generate --targets * --features * 
    git diff --exit-code || (echo "Generated files are out of sync" && exit 1)
```

### Watch Mode
```bash
# Watch and regenerate only rules for faster development
npx rulesync watch --features rules

# Watch all features
npx rulesync watch --features *
```

## Performance Benefits

### Generation Speed Comparison
| Features | Typical Generation Time | Use Case |
|----------|------------------------|----------|
| `rules` only | ~0.5s | Quick rule updates |
| `rules,commands` | ~0.8s | Development with commands |
| `rules,mcp` | ~1.2s | Production setup |
| `rules,ignore` | ~0.7s | Security-focused |
| `*` (all) | ~1.5s | Complete generation |

### Resource Usage
- **Memory**: Reduced memory usage when generating fewer features
- **Disk I/O**: Less file writing with selective generation
- **Network**: MCP validation skipped when `mcp` feature not requested

## Best Practices

### Development
```bash
# During active development, generate only rules for speed
npx rulesync generate --targets cursor --features rules

# Add commands when testing command functionality
npx rulesync generate --targets cursor --features rules,commands
```

### Production
```bash
# Generate all features for complete setup
npx rulesync generate --targets * --features *

# Or be explicit about production needs
npx rulesync generate --targets * --features rules,mcp,ignore
```

### Team Collaboration
```bash
# Set team defaults in rulesync.jsonc
{
  "features": ["rules", "mcp"],
  "defaultTargets": ["claudecode", "cursor", "copilot"]
}

# Individual developers can override as needed
npx rulesync generate --features rules  # Override to rules-only
```

## Troubleshooting

### Common Issues

#### Feature Not Generated
**Problem**: Expected files not created
**Solution**: Check if the tool supports the requested feature
```bash
# Check what features are supported
npx rulesync generate --targets copilot --features commands --verbose
# Will show warning if commands not supported for Copilot
```

#### Backward Compatibility Warning
**Problem**: Warning about missing --features
**Solution**: Add explicit --features specification
```bash
# Instead of this (shows warning)
npx rulesync generate --targets *

# Use this (no warning)
npx rulesync generate --targets * --features *
```

#### Configuration Override Issues
**Problem**: CLI features don't match config file
**Solution**: Understand precedence order
```bash
# CLI options take precedence over config file
npx rulesync generate --features rules  # Overrides config file setting
```

This selective generation system makes rulesync more efficient and flexible, allowing teams to generate exactly what they need for their specific workflow requirements.