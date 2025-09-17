# Contributing to Rulesync

Thank you for your interest in contributing to Rulesync! This guide will help you get started with development, testing, and contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Adding New AI Tool Support](#adding-new-ai-tool-support)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Getting Started

Rulesync is a Node.js CLI tool that generates configuration files for various AI development tools from unified AI rule files. It supports 19+ AI development tools including GitHub Copilot, Cursor, Claude Code, Cline, and many others.

### Prerequisites

- **Node.js**: Version 20 or higher (project uses Node.js 24)
- **pnpm**: Latest version (used as the package manager)
- **Python**: Version 3+ (for some development tools)
- **uv**: Latest version (for Python package management)

You can install these using [mise](https://mise.jdx.dev/):

```bash
mise install  # Installs versions specified in mise.toml
```

## Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/rulesync.git
   cd rulesync
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up git hooks:**
   ```bash
   pnpm run prepare
   ```

4. **Run development build:**
   ```bash
   pnpm run dev
   ```

5. **Verify setup:**
   ```bash
   pnpm run check  # Runs all quality checks
   pnpm test       # Runs test suite
   ```

## Project Structure

```
rulesync/
├── src/
│   ├── cli/            # CLI commands and entry point
│   │   ├── commands/   # Command implementations (init, generate, import, etc.)
│   │   └── index.ts    # Main CLI entry point
│   ├── commands/       # Tool-specific command generators
│   ├── config/         # Configuration handling
│   ├── constants/      # Shared constants and schemas
│   ├── ignore/         # Ignore file processors for various tools
│   ├── mcp/           # Model Context Protocol configurations
│   ├── rules/         # Rule file processors for various tools
│   ├── subagents/     # Subagent configurations (Claude Code)
│   ├── types/         # TypeScript type definitions
│   └── utils/         # Utility functions
├── .rulesync/         # Rulesync's own configuration
│   ├── rules/         # Rule definitions and specifications
│   ├── commands/      # Development commands
│   └── subagents/     # Development subagents
├── scripts/           # Development scripts
└── tests/             # Test files (co-located with source)
```
### Key Directories

- **`src/cli/`**: Contains the main CLI interface and command implementations
- **`src/rules/`**: Contains processors for different AI tool rule formats
- **`src/mcp/`**: Contains MCP (Model Context Protocol) configuration generators
- **`src/ignore/`**: Contains ignore file processors for various AI tools
- **`src/types/`**: TypeScript type definitions and interfaces
- **`.rulesync/`**: The project's own Rulesync configuration with comprehensive specifications

## Development Workflow

### Available Scripts

```bash
# Development
pnpm dev                    # Run CLI in development mode
pnpm generate               # Generate configurations using dev build

# Code Quality
pnpm check                  # Run all quality checks (biome, oxlint, eslint, typecheck)
pnpm fix                    # Auto-fix all fixable issues
pnpm bcheck                 # Run Biome checks
pnpm oxlint                 # Run Oxlint
pnpm eslint                 # Run ESLint
pnpm typecheck             # TypeScript type checking

# Testing
pnpm test                   # Run tests once
pnpm test:watch            # Run tests in watch mode
pnpm test:coverage         # Run tests with coverage

# Security & Spelling
pnpm secretlint            # Check for secrets in code
pnpm cspell                # Spell checking

# Build
pnpm build                 # Build for production (CJS + ESM + TypeScript declarations)
```

### Development Process

1. **Start with an issue**: Look for existing issues or create a new one
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make changes**: Follow the coding guidelines below
4. **Test thoroughly**: Run `pnpm test` and `pnpm check`
5. **Commit changes**: Use conventional commit format
6. **Push and create PR**: Submit a pull request for review

## Testing

The project uses [Vitest](https://vitest.dev/) for testing with the following conventions:

### Test Organization

- **Co-located tests**: Test files are placed next to their implementation files
- **Naming**: Use `.test.ts` extension for test files
- **Directory isolation**: Each test uses isolated temporary directories

### Test Directory Guidelines

**MANDATORY**: All tests that create files must use the unified test directory pattern:

```typescript
import { setupTestDirectory } from "../test-utils/index.js";

describe("Test Name", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should do something", async () => {
    // Use testDir for file operations
    const filePath = join(testDir, "test-file.md");
    // ... test implementation
  });
});
```

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test:watch        # Run tests in watch mode
pnpm test:coverage     # Run with coverage report
```

## Code Quality

The project uses multiple tools to ensure code quality:

### Code Formatting and Linting

- **[Biome](https://biomejs.dev/)**: Primary formatter and linter
- **[Oxlint](https://oxc.rs/docs/guide/usage/linter.html)**: Fast additional linter
- **[ESLint](https://eslint.org/)**: Additional linting rules including custom plugins

### TypeScript Configuration

- Uses `@tsconfig/node24` as base configuration
- Strict type checking enabled
- Import/export validation with custom ESLint plugins

### Pre-commit Hooks

The project uses `simple-git-hooks` with `lint-staged` to run quality checks on staged files:

- Code formatting with Biome
- Linting with Oxlint and ESLint
- Type checking
- Secret detection with secretlint

## Adding New AI Tool Support

To add support for a new AI tool, follow these steps:

### 1. Create Specification File

Create a specification file in `.rulesync/rules/specification-{toolname}-{feature}.md`:

```markdown
# Tool Name Feature Specification

## Overview
Brief description of the tool and its configuration format.

## File Placement
- **File**: Configuration file name and location
- **Scope**: Where the configuration applies

## Format
Describe the expected file format, syntax, and structure.

## Examples
Provide concrete examples of the configuration format.
```

### 2. Implement Rule Processor

Create a rule processor in `src/rules/{toolname}-rule.ts`:

```typescript
import type { RuleFileProcessor } from "../types/feature-processor.js";

export const toolNameRuleProcessor: RuleFileProcessor = {
  toolName: "toolname",
  generate: async (options) => {
    // Implementation for generating rule files
    return {
      files: [
        {
          path: "path/to/config/file",
          content: "generated content"
        }
      ]
    };
  },
  import: async (options) => {
    // Implementation for importing existing configurations
    return {
      rules: [
        // imported rule content
      ]
    };
  }
};
```

### 3. Add Tool Definition

Add the tool to `src/types/tool-targets.ts`:

```typescript
export const TOOL_TARGETS = [
  // ... existing tools
  "toolname"
] as const;
```

### 4. Register Processors

Register processors in the appropriate processor files:
- `src/rules/rules-processor.ts` for rules
- `src/mcp/mcp-processor.ts` for MCP configurations
- `src/ignore/ignore-processor.ts` for ignore files

### 5. Add Tests

Create comprehensive tests for the new tool support:

```typescript
// src/rules/toolname-rule.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { toolNameRuleProcessor } from "./toolname-rule.js";

describe("toolNameRuleProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should generate rule files", async () => {
    // Test implementation
  });
});
```

### 6. Update Documentation

Add documentation in the appropriate locations:
- Update README.md with the new tool
- Create tool-specific documentation if needed
- Update relevant specification files

## Submitting Changes

### Pull Request Process

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the guidelines above
3. **Write or update tests** to cover your changes
4. **Run quality checks**: `pnpm check && pnpm test`
5. **Commit with conventional commit format**:
   ```
   feat: add support for new AI tool
   fix: resolve issue with configuration generation
   docs: update contributing guidelines
   test: add tests for new functionality
   ```
6. **Push to your fork** and create a pull request
7. **Address review feedback** if any

### PR Requirements

- [ ] All tests pass (`pnpm test`)
- [ ] Code quality checks pass (`pnpm check`)
- [ ] New functionality includes tests
- [ ] Documentation is updated if needed
- [ ] Commits follow conventional commit format
- [ ] PR description clearly explains the changes

### Code Review Process

- Maintainers will review PRs within a few days
- Address feedback promptly
- Keep PRs focused and reasonably sized
- Be open to suggestions and improvements

## Release Process

The project uses semantic versioning and automated releases:

1. **Version bumping**: Handled automatically based on conventional commits
2. **Release notes**: Generated automatically from commit messages
3. **NPM publishing**: Automated via GitHub Actions on release

### Release Types

- **Major**: Breaking changes (rare)
- **Minor**: New features, new tool support
- **Patch**: Bug fixes, documentation updates

## Development Tips

### Working with the CLI

During development, you can test the CLI using:

```bash
# Use development build
pnpm dev init
pnpm dev generate --targets cursor --features rules

# Test with different options
pnpm dev generate --targets "*" --features "*"
```

### Debugging

Enable debug output for troubleshooting:

```bash
npm dev generate --targets cursor --verbose
```

### IDE Setup

The project includes VS Code configuration with recommended extensions:
- Biome for formatting and linting
- ESLint for additional linting
- GitLens for Git integration
- Various language support extensions

## Getting Help

- **Issues**: Create GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Code review**: Maintainers will provide guidance during PR review

## Code of Conduct

Please be respectful and constructive in all interactions. We want Rulesync to be welcoming to contributors of all backgrounds and experience levels.

---

Thank you for contributing to Rulesync! Your efforts help make AI development tools more accessible and consistent for developers worldwide.