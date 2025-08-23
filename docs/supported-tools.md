# Supported AI Tools

rulesync supports **19+ AI development tools** with comprehensive rule, MCP, ignore/permission, and subagent file generation.

## Core AI Development Tools

### GitHub Copilot
- **Configuration**: Custom Instructions (`.github/copilot-instructions.md` + `.github/instructions/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: Multiple instruction file formats, team sharing via GitHub

### Cursor
- **Configuration**: Project Rules (`.cursor/rules/` + `.cursorrules`)
- **Features**: Rules (4 rule types: always, manual, specificFiles, intelligently), Commands, MCP, Ignore
- **Special Features**: Advanced rule activation modes, Composer integration

### Cline
- **Configuration**: Rules & Instructions (`.cline/instructions.md` + `.clinerules/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: VSCode extension integration, flat rules structure

### Claude Code
- **Configuration**: Memory System (`CLAUDE.md` + `.claude/memories/`)
- **Features**: Rules, Commands, MCP, Ignore, **Subagents**
- **Special Features**: ⭐ **Subagent support**, hierarchical memory system, nested tool configurations
- **Subagents**: Specialized AI assistants with custom models, temperature, and token limits

### Amazon Q Developer CLI
- **Configuration**: Rules & Context (`.amazonq/rules/*.md`)
- **Features**: Rules, MCP, Built-in Commands
- **Special Features**: AWS integration, context management, comprehensive built-in slash commands

### Windsurf
- **Configuration**: AI Code Editor (`.windsurf/rules/` + memories)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: Multiple activation modes, auto-generated memories

## Specialized AI Tools

### OpenCode
- **Configuration**: Permission-based Security (`AGENTS.md` + `opencode.json`)
- **Features**: Rules, Commands, MCP, **Permissions** (instead of ignore files)
- **Special Features**: 🔐 Revolutionary permission-based system with granular read/write/execute controls

### OpenAI Codex CLI
- **Configuration**: Advanced File Splitting (`AGENTS.md` + XML references + `.codex/memories/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: File splitting with XML document references, memory file system

### AugmentCode
- **Configuration**: IDE Integration (`.augment/rules/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: Current & legacy format support, IDE integration

### Roo Code
- **Configuration**: VSCode Extension (`.roo/instructions.md` + `.roo/rules/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: VSCode extension, hierarchical rules system

### Gemini CLI
- **Configuration**: Google AI (`GEMINI.md` + `.gemini/memories/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: Google AI integration, memory system, custom commands

### Qwen Code
- **Configuration**: Qwen Models (`QWEN.md` + `.qwen/memories/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: Git-aware filtering, Qwen model optimization

## IDE-Integrated AI

### JetBrains Junie
- **Configuration**: IntelliJ Family (`.junie/guidelines.md`)
- **Features**: Rules, MCP, Ignore
- **Special Features**: JetBrains IDE integration, guidelines format

### Kiro IDE
- **Configuration**: AWS IDE (`.kiro/steering/`)
- **Features**: Rules, MCP, Ignore
- **Special Features**: AWS IDE integration, custom steering documents

## Standardized Formats

### AgentsMd
- **Configuration**: Universal Format (`AGENTS.md` + `.agents/memories/`)
- **Features**: Rules, Commands, MCP, Ignore
- **Special Features**: Universal standard format, cross-tool compatibility

### AugmentCode Legacy
- **Configuration**: Backward Compatibility (`.augment-guidelines` format)
- **Features**: Rules, Ignore
- **Special Features**: Legacy format support for existing projects

## Feature Type Support Matrix

| Tool | Rules | Commands | MCP | Ignore/Permissions | Subagents |
|------|-------|----------|-----|-------------------|-----------|
| GitHub Copilot | ✅ | ✅ | ✅ | ✅ | ❌ |
| Cursor | ✅ | ✅ | ✅ | ✅ | ❌ |
| Cline | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | ⭐ **✅** |
| Amazon Q CLI | ✅ | Built-in | ✅ | ❌ | ❌ |
| Windsurf | ✅ | ✅ | ✅ | ✅ | ❌ |
| OpenCode | ✅ | ✅ | ✅ | 🔐 Permissions | ❌ |
| Codex CLI | ✅ | ✅ | ✅ | ✅ | ❌ |
| AugmentCode | ✅ | ✅ | ✅ | ✅ | ❌ |
| Roo Code | ✅ | ✅ | ✅ | ✅ | ❌ |
| Gemini CLI | ✅ | ✅ | ✅ | ✅ | ❌ |
| Qwen Code | ✅ | ✅ | ✅ | ✅ | ❌ |
| JetBrains Junie | ✅ | ❌ | ✅ | ✅ | ❌ |
| Kiro IDE | ✅ | ❌ | ✅ | ✅ | ❌ |
| AgentsMd | ✅ | ✅ | ✅ | ✅ | ❌ |
| AugmentCode Legacy | ✅ | ❌ | ❌ | ✅ | ❌ |

## Tool-Specific Features

### Subagents (Claude Code Only)
- **Purpose**: Specialized AI assistants with specific behaviors and personalities
- **Configuration**: Nested frontmatter with tool-specific settings:
  ```yaml
  claudecode:
    model: "claude-3-5-sonnet-20241022"
    temperature: 0.7
    maxTokens: 4000
  ```
- **Output**: Generated to `.claude/subagents/*.md`
- **Use Cases**: Code review specialists, security experts, documentation writers

### Permission System (OpenCode Only)
- **Revolutionary Approach**: Granular read/write/execute permissions instead of traditional ignore files
- **Configuration**: `opencode.json` with permission matrices
- **Benefits**: Superior security, flexibility, and control over AI actions
- **Innovation**: Sets new standard for AI tool security

### File Splitting (Codex CLI)
- **Advanced System**: XML document references for large rule sets
- **Benefits**: Better organization, faster loading, modular structure
- **Output**: Root file with XML references + memory files

### Activation Modes (Cursor & Windsurf)
- **Cursor**: Always, manual, specificFiles, intelligently
- **Windsurf**: Always-on, manual, model-decision, glob patterns
- **Benefits**: Fine-grained control over when rules are applied

## Target Selection

### Generate for Specific Tools
```bash
# Single tool
npx rulesync generate --targets claudecode --features subagents

# Multiple tools
npx rulesync generate --targets copilot,cursor,cline

# All tools
npx rulesync generate --targets *
```

### Feature Selection
```bash
# Only rules
npx rulesync generate --targets * --features rules

# Rules and subagents
npx rulesync generate --targets claudecode --features rules,subagents

# All features
npx rulesync generate --targets * --features *
```

## Adding New Tools

rulesync uses a registry pattern that makes adding new AI tools straightforward:

1. **Simple Tools**: Add configuration to generator registry
2. **Complex Tools**: Create custom generators for advanced features
3. **Testing**: Comprehensive test coverage (250-350 lines per tool)
4. **Documentation**: Complete specifications for each tool

For detailed instructions, see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-new-ai-tools---registry-based-workflow).

## Tool Evolution

The AI development tools landscape is rapidly evolving. rulesync stays current with:

- **Regular Updates**: New tool versions and features
- **Community Feedback**: User requests and suggestions  
- **Innovation Tracking**: Emerging tools and standards
- **Backward Compatibility**: Maintaining support for existing setups

### Recent Additions

- **Windsurf**: Complete integration with activation modes and memory system
- **Amazon Q CLI**: Context management and built-in commands
- **Subagents**: Specialized AI assistants (Claude Code)
- **Permission System**: Revolutionary security approach (OpenCode)
- **Enhanced MCP**: Model Context Protocol support across all tools