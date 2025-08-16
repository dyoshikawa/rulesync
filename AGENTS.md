Please also reference the following documents as needed:

@.claude/memories/precautions.md description: "rulesync project precautions" globs: "**/*"
@.claude/memories/specification-augmentcode-ignore.md description: "AugmentCode ignore files specification for controlling AI file access" globs: ""
@.claude/memories/specification-augmentcode-mcp.md description: "AugmentCode MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-augmentcode-rules.md description: "AugmentCode rules specification for configuration file generation" globs: ""
@.claude/memories/specification-claudecode-commands.md description: "Claude Code custom slash commands specification" globs: ""
@.claude/memories/specification-claudecode-ignore.md description: "Claude Code settings.json permission.deny specification for security configuration" globs: ""
@.claude/memories/specification-claudecode-mcp.md description: "Claude Code MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-claudecode-rules.md description: "Claude Code memories specification" globs: ""
@.claude/memories/specification-cline-ignore.md description: "Specification document for Cline VSCode Extension .clineignore file" globs: ""
@.claude/memories/specification-cline-mcp.md description: "Cline MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-cline-rules.md description: "Cline rules specification" globs: ""
@.claude/memories/specification-codexcli-ignore.md description: "OpenAI Codex CLI file exclusion and ignore patterns specification" globs: ""
@.claude/memories/specification-codexcli-mcp.md description: "OpenAI Codex CLI MCP (Model Context Protocol) server configuration specification" globs: ""
@.claude/memories/specification-codexcli-rules.md description: "OpenAI Codex CLI instructions and memory file specification" globs: ""
@.claude/memories/specification-copilot-ignore.md description: "GitHub Copilot Content exclusion feature specification" globs: ""
@.claude/memories/specification-copilot-mcp.md description: "GitHub Copilot MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-copilot-rules.md description: "GitHub Copilot custom instructions specification" globs: ""
@.claude/memories/specification-cursor-mcp.md description: "Cursor MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-cursor-rules.md description: "Cursor project rules specification" globs: ""
@.claude/memories/specification-gemincli-commands.md description: "Gemini CLI custom slash commands specification" globs: ""
@.claude/memories/specification-gemincli-ignore.md description: "Gemini CLI Coding Assistant .aiexclude file specification" globs: ""
@.claude/memories/specification-gemincli-mcp.md description: "Gemini CLI MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-gemincli-rules.md description: "Gemini CLI Memory (GEMINI.md) specification for configuration file generation" globs: ""
@.claude/memories/specification-junie-ignore.md description: "JetBrains Junie .aiignore file specification for controlling file access and privacy" globs: ""
@.claude/memories/specification-junie-mcp.md description: "JetBrains Junie Model Context Protocol (MCP) server configuration specification" globs: ""
@.claude/memories/specification-junie-rules.md description: "JetBrains Junie AI coding assistant guidelines and rules configuration specification" globs: ""
@.claude/memories/specification-kiro-ignore.md description: "Kiro IDE ignore files specification and best practices" globs: ""
@.claude/memories/specification-kiro-mcp.md description: "Kiro IDE MCP (Model Context Protocol) configuration and AWS integration" globs: ""
@.claude/memories/specification-kiro-rules.md description: "Kiro IDE spec-driven development and steering documents configuration" globs: ""
@.claude/memories/specification-opencode-ignore.md description: "SST OpenCode file exclusion and ignore patterns for controlling AI access to sensitive files" globs: ""
@.claude/memories/specification-opencode-mcp.md description: "SST OpenCode MCP (Model Context Protocol) server configuration and integration specification" globs: ""
@.claude/memories/specification-opencode-rules.md description: "SST OpenCode AI assistant rules and memory configuration using AGENTS.md and opencode.json files" globs: ""
@.claude/memories/specification-roo-commands.md description: "Roo Code custom slash commands specification" globs: ""
@.claude/memories/specification-roo-ignore.md description: "Roocode AI Coding Assistant .rooignore file specification" globs: ""
@.claude/memories/specification-roo-mcp.md description: "Roo Code MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-roo-rules.md description: "Roo Code rules and memories configuration specification" globs: ""
@.claude/memories/specification-windsurf-ignore.md description: "Windsurf AI code editor ignore files configuration specification" globs: ""
@.claude/memories/specification-windsurf-mcp.md description: "Windsurf AI code editor MCP (Model Context Protocol) configuration specification" globs: ""
@.claude/memories/specification-windsurf-rules.md description: "Windsurf AI code editor rules and memories configuration specification" globs: ""
@.claude/memories/testing.md description: "Testing directory unification rules" globs: "**/*.test.ts"

# rulesync Project Overview

This is rulesync, a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

## Project Architecture

- **CLI Interface**: Built with Commander.js for command-line operations
- **Core Engine**: TypeScript-based processing engine for rule parsing and generation
- **Multi-Tool Support**: Generates configurations for 9+ AI development tools
- **Configuration Management**: Supports JSONC and TypeScript configuration files

## Supported AI Tools

- GitHub Copilot Custom Instructions
- Cursor Project Rules
- Cline Rules
- Claude Code Memory
- AugmentCode Rules
- Roo Code Rules
- Gemini CLI
- JetBrains Junie Guidelines
- Kiro IDE Custom Steering Documents

## Development Standards

- **TypeScript-first**: All source code in TypeScript with strict configuration
- **Modern Node.js**: Requires Node.js >=20.0.0, uses ES modules
- **Quality Tools**: Biome, ESLint, Oxlint for code quality
- **Testing**: Vitest for unit and integration testing
- **Build System**: tsup for bundling CJS/ESM outputs

## Key Components

- `/src/cli/`: Command-line interface and command handlers
- `/src/core/`: Core parsing, generation, and validation logic
- `/src/generators/`: Tool-specific configuration generators
- `/src/parsers/`: Import parsers for existing configurations
- `/src/types/`: TypeScript type definitions
- `/src/utils/`: Utility functions and helpers

## Rule System

- **Two-level hierarchy**: Root rules (project overview) and detail rules (specific guidelines)
- **Frontmatter-driven**: YAML frontmatter defines rule metadata
- **Multi-target**: Rules can target specific tools or all tools
- **Glob patterns**: File pattern matching for rule application
