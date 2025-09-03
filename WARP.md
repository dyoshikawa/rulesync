Please also reference the following documents as needed. In this case, `@` stands for the project root directory.

<Documents>
  <Document>
    <Path>@.warp/memories/coding-guides.md</Path>
  </Document>
  <Document>
    <Path>@.warp/memories/precautions.md</Path>
  </Document>
  <Document>
    <Path>@.warp/memories/testing.md</Path>
  </Document>
</Documents>

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