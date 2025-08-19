---
root: false
targets: ["*"]
description: "Qwen Code rules and memory configuration specification for AI-assisted coding"
globs: []
---

# Qwen Code Rules and Memory Configuration Specification

## Overview
Qwen Code uses a context management system similar to Gemini CLI to provide persistent project-specific context and rules through Markdown files. The system is based on Gemini CLI architecture and supports both global and project-level configuration files.

## File Placement and Structure

### Primary Configuration Location
- **File**: `QWEN.md` (default context file)
- **Location**: Project root directory or discovered hierarchically
- **Scope**: Project-specific context and rules
- **Version Control**: Should be committed to repository for team consistency

### Alternative Configuration Names
The context filename can be customized through `settings.json`:
- **Configuration**: `"contextFileName": "AGENTS.md"` or array of accepted names
- **Examples**: `QWEN.md`, `AGENTS.md`, `GEMINI.md`
- **Multiple Files**: Can specify array like `["QWEN.md", "AGENTS.md"]`

### Context File Discovery Hierarchy

#### 1. Global Context
- **Location**: `~/.qwen/QWEN.md` (or configured filename)
- **Scope**: Default instructions for all projects
- **Usage**: Personal coding preferences and universal standards

#### 2. Project Context  
- **Discovery**: Searches from current directory up to project root (.git folder) or home directory
- **Scope**: Project-wide context and coding standards
- **Priority**: Overrides global context

#### 3. Local Context
- **Discovery**: Scans subdirectories below current working directory
- **Limits**: Up to 200 directories (configurable via `memoryDiscoveryMaxDirs`)
- **Exclusions**: Respects ignore patterns (`node_modules`, `.git`, etc.)
- **Scope**: Component or module-specific instructions

## File Format

### Basic Structure
- **Format**: Plain Markdown (`.md`)
- **Encoding**: UTF-8
- **Structure**: No special frontmatter required - entire file becomes AI context
- **Size**: Keep reasonable for LLM context window

### Content Organization
```markdown
# Project: MyProject

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- Database: PostgreSQL
- AI Models: Qwen3-Coder

## Coding Standards
- Use TypeScript strict mode
- Prefer functional components with hooks
- Write comprehensive tests
- Follow clean architecture principles

## Security Guidelines
- Never commit API keys or secrets
- Validate all user inputs
- Use environment variables for configuration
- Implement proper authentication

## AI Assistant Instructions
- Focus on Qwen3-Coder optimized patterns
- Provide detailed code explanations
- Include error handling in all functions
- Use descriptive variable names
```

## Settings Configuration

### settings.json Locations
Configuration files in hierarchical order:

1. **System Settings** (highest priority)
   - Linux: `/etc/gemini-cli/settings.json`
   - Windows: `C:\ProgramData\gemini-cli\settings.json`
   - macOS: `/Library/Application Support/GeminiCli/settings.json`
   - Override: `GEMINI_CLI_SYSTEM_SETTINGS_PATH` environment variable

2. **Project Settings**
   - **File**: `.qwen/settings.json` in project root
   - **Scope**: Project-specific configuration
   - **Version Control**: Should be committed for team consistency

3. **User Settings** (lowest priority)
   - **File**: `~/.qwen/settings.json`
   - **Scope**: Personal preferences across all projects

### Context Configuration
```json
{
  "contextFileName": "QWEN.md",
  "memoryDiscoveryMaxDirs": 200,
  "loadMemoryFromIncludeDirectories": true,
  "includeDirectories": [
    "/path/to/shared/project",
    "../shared-library",
    "~/common-utils"
  ]
}
```

### Environment Variable Support
Settings can reference environment variables:
```json
{
  "apiKey": "$QWEN_API_KEY",
  "baseUrl": "${QWEN_BASE_URL}",
  "model": "$QWEN_MODEL"
}
```

## Memory Management Commands

### CLI Commands
- **`/memory refresh`**: Reload all context files from disk
- **`/memory show`**: Display current loaded context
- **`/memory add`**: Add content to the AI's instructional context

### Context Loading Behavior
- Automatically loads on CLI startup
- Searches hierarchically through directory structure
- Merges multiple context files when found
- Respects file discovery limits and ignore patterns

## Advanced Configuration

### File Filtering
```json
{
  "fileFiltering": {
    "respectGitIgnore": true,
    "enableRecursiveFileSearch": true
  }
}
```

### Context File Arrays
```json
{
  "contextFileName": ["QWEN.md", "AGENTS.md", "PROJECT.md"]
}
```

### Excluded Environment Variables
```json
{
  "excludedProjectEnvVars": ["DEBUG", "DEBUG_MODE", "NODE_ENV"]
}
```

## Environment Variables

### .env File Loading Order
1. `.env` in current working directory
2. Search upward in parent directories for `.env`
3. `~/.env` (user's home directory)
4. `.qwen/.env` files are never excluded

### Required Variables
- **`QWEN_API_KEY`**: API key for Qwen models
- **`OPENAI_API_KEY`**: For OpenAI-compatible endpoints
- **`OPENAI_BASE_URL`**: Custom API endpoint
- **`OPENAI_MODEL`**: Model specification

## Best Practices

### Content Guidelines
1. **Be Specific**: Include concrete examples and patterns
2. **Project Context**: Provide technology stack and architecture details
3. **Security Focus**: Emphasize security practices and constraints
4. **Model Optimization**: Include Qwen3-Coder specific instructions
5. **Keep Current**: Regular updates as project evolves

### File Organization
1. **Hierarchical Structure**: Use global, project, and local context appropriately
2. **Consistent Naming**: Use standardized context filenames
3. **Version Control**: Commit project context files for team sharing
4. **Documentation**: Document context file purposes and conventions

### Team Collaboration
1. **Shared Context**: Commit `.qwen/settings.json` and context files
2. **Environment Setup**: Document required environment variables
3. **Regular Review**: Update context files based on project evolution
4. **Standards**: Establish team conventions for context organization

## Integration with Qwen3-Coder

### Model-Specific Instructions
```markdown
## Qwen3-Coder Optimization
- Leverage advanced code understanding capabilities
- Use multi-language programming support
- Apply agentic coding patterns
- Implement function calling where appropriate
- Use code interpretation features for complex analysis
```

### Workflow Integration
- Context automatically loaded for all Qwen Code sessions
- Integrates with MCP servers for extended functionality
- Supports custom tool discovery and execution
- Works with file discovery and @ commands

## Migration from Other Tools

### From Gemini CLI
- Direct compatibility - files work without modification
- Same settings.json structure
- Identical context discovery mechanism

### From Other AI Tools
```bash
# Example migration steps
# 1. Copy existing rules to QWEN.md
cp .cursorrules QWEN.md
# 2. Update format to markdown if needed
# 3. Configure contextFileName if using different name
```

This specification provides comprehensive guidance for configuring Qwen Code's context and memory system, enabling effective AI-assisted development workflows with persistent project knowledge and coding standards optimized for Qwen3-Coder models.