---
root: true # true that is less than or equal to one file for overview such as AGENTS.md, false for details such as .agents/memories/*.md
targets: ["*"] # * = all, or specific tools
description: "rulesync project overview and development guidelines for unified AI rules management CLI tool"
globs: ["**/*"] # file patterns to match (e.g., ["*.md", "*.txt"])
cursor: # for cursor-specific rules
  alwaysApply: true
  description: "rulesync project overview and development guidelines for unified AI rules management CLI tool"
  globs: ["*"]
---

# rulesync Project Overview

This is rulesync, a Node.js CLI tool that automatically generates configuration files for various AI coding tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

## Project Architecture

- **CLI Interface**: Built with Commander.js for command-line operations
- **Core Engine**: TypeScript-based processing engine for rule parsing and generation
- **Multi-Tool Support**: Generates configurations for major AI coding tools
- **Configuration Management**: Supports JSONC and TypeScript configuration files
