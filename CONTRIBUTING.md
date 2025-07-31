# Contributing to rulesync

We welcome contributions to rulesync! This document outlines the process for contributing and how to get started.

**English** | [日本語](./CONTRIBUTING.ja.md)

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/rulesync.git`
3. Install dependencies: `pnpm install`
4. Set up git hooks: `npx simple-git-hooks`
5. Create a new branch: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites

- Node.js 20+ (recommended: 24+)
- pnpm (recommended) or npm/yarn

### MCP Connection Setup

If you're using Claude Code with MCP (Model Context Protocol), set up the following environment variables:

- `OPENAI_API_KEY` - Required for OpenAI integration
- `GITHUB_PERSONAL_ACCESS_TOKEN` - Required for GitHub MCP server functionality

### Development Commands

```bash
# Install dependencies
pnpm install

# Run in development mode with hot reload
pnpm dev

# Build the project
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Format code
pnpm format

# Check formatting
pnpm format:check

# Run comprehensive checks (Biome + Oxlint + ESLint + TypeScript)
pnpm check

# Fix linting and formatting issues
pnpm fix

# Check for secrets
pnpm secretlint

# Spell checking
pnpm cspell

# Type checking
pnpm typecheck
```

## Project Architecture

### Simplified .rulesync Directory

The project has been simplified with a streamlined .rulesync directory structure:

```
.rulesync/
├── overview.md              # Project overview and architecture (root: true)
├── my-instructions.md       # Custom project instructions
├── precautions.md          # Development precautions and guidelines
└── specification-[tool]-[type].md  # Tool-specific specifications
    # Types: rules, mcp, ignore
    # Tools: augmentcode, copilot, cursor, cline, claudecode, 
    #        codexcli, geminicli, junie, kiro, roo
```

**Key Changes**: Removed 5 specialized rule files (build-tooling.md, cli-development.md, docs-maintenance.md, mcp-support.md, security-quality.md) to simplify the rule structure.

### Core Structure

```
rulesync/
├── src/
│   ├── cli/
│   │   ├── commands/        # CLI command implementations
│   │   │   ├── init.ts      # Initialize project
│   │   │   ├── add.ts       # Add new rule files
│   │   │   ├── generate.ts  # Generate configurations
│   │   │   ├── import.ts    # Import existing configurations
│   │   │   ├── watch.ts     # File watching
│   │   │   ├── status.ts    # Project status
│   │   │   ├── validate.ts  # Rule validation
│   │   │   ├── gitignore.ts # .gitignore management
│   │   │   └── config.ts    # Configuration management
│   │   └── index.ts        # CLI entry point (Commander.js)
│   ├── core/
│   │   ├── parser.ts       # Parse .rulesync/*.md files
│   │   ├── generator.ts    # Orchestrate generation
│   │   ├── importer.ts     # Import existing configurations
│   │   ├── validator.ts    # Validate rule structure
│   │   ├── mcp-generator.ts # MCP-specific generation logic
│   │   └── mcp-parser.ts   # MCP-specific parsing logic
│   ├── generators/         # Tool-specific generators (organized by output type)
│   │   ├── rules/          # Standard rule generators
│   │   │   ├── augmentcode.ts  # AugmentCode Rules
│   │   │   ├── copilot.ts     # GitHub Copilot Custom Instructions
│   │   │   ├── cursor.ts      # Cursor Project Rules (MDC format)
│   │   │   ├── cline.ts       # Cline Rules
│   │   │   ├── claudecode.ts  # Claude Code Memory (CLAUDE.md + memories)
│   │   │   ├── codexcli.ts    # OpenAI Codex CLI Rules (codex.md hierarchy)
│   │   │   ├── geminicli.ts   # Gemini CLI configuration (GEMINI.md + memories)
│   │   │   ├── junie.ts       # JetBrains Junie Guidelines
│   │   │   ├── kiro.ts        # Kiro IDE Custom Steering Documents
│   │   │   └── roo.ts         # Roo Code Rules
│   │   ├── mcp/            # MCP configuration generators
│   │   │   └── [tool].ts   # MCP-specific configs for each tool
│   │   └── ignore/         # Ignore file generators
│   │       └── [tool].ts   # Tool-specific ignore configurations
│   ├── parsers/           # Tool-specific parsers for import functionality
│   │   ├── augmentcode.ts # Parse AugmentCode configurations
│   │   ├── copilot.ts     # Parse GitHub Copilot configurations (.github/copilot-instructions.md)
│   │   ├── cursor.ts      # Parse Cursor configurations (.cursorrules, .cursor/rules/*.mdc)
│   │   │                  # Supports 4 rule types: always, manual, specificFiles, intelligently
│   │   ├── cline.ts       # Parse Cline configurations (.cline/instructions.md)
│   │   ├── claudecode.ts  # Parse Claude Code configurations (CLAUDE.md, .claude/memories/*.md)
│   │   ├── codexcli.ts    # Parse OpenAI Codex CLI configurations (codex.md hierarchy)
│   │   ├── geminicli.ts   # Parse Gemini CLI configurations (GEMINI.md, .gemini/memories/*.md)
│   │   ├── junie.ts       # Parse JetBrains Junie configurations
│   │   ├── kiro.ts        # Parse Kiro IDE configurations
│   │   └── roo.ts         # Parse Roo Code configurations (.roo/instructions.md)
│   ├── types/              # TypeScript type definitions
│   │   ├── config.ts      # Configuration types
│   │   ├── rules.ts       # Rule and frontmatter types
│   │   ├── mcp.ts         # MCP-specific types
│   │   ├── tool-targets.ts # Tool target definitions
│   │   └── config-options.ts # Configuration option types
│   └── utils/
│       ├── file.ts         # File operations (read/write/delete)
│       ├── config.ts       # Configuration management
│       ├── config-loader.ts # Configuration loading utilities
│       ├── ignore.ts       # Ignore file utilities
│       ├── rules.ts        # Rule processing utilities
│       └── parser-helpers.ts # Parser utility functions
├── dist/                   # Build output (CJS + ESM)
└── [module].test.ts        # Test files (co-located with source)
```

### Key Dependencies

- **Commander.js**: CLI framework for command-line interface
- **gray-matter**: Frontmatter parsing for Markdown files (supports YAML, TOML, JSON)
- **marked**: Markdown parsing and rendering
- **chokidar**: File watching for `watch` command with high performance
- **c12**: Configuration loading with support for multiple formats
- **micromatch**: Glob pattern matching for file filtering
- **zod**: Runtime type validation and schema definition
- **js-yaml**: YAML parsing and stringification
- **tsup**: Build system (outputs both CJS and ESM)
- **tsx**: TypeScript execution for development
- **Biome**: Unified linter and formatter (primary)
- **ESLint**: Additional linting with custom plugins
- **Oxlint**: Fast Rust-based linter for additional checks
- **Vitest**: Testing framework with coverage
- **cspell**: Spell checker for code and documentation

### Build System

- **Target**: Node.js 20+ (recommended: 24+)
- **TypeScript**: Strict mode with `@tsconfig/node24`
- **Output**: Both CommonJS (`dist/index.js`) and ESM (`dist/index.mjs`)
- **Binary**: `dist/index.js` (executable entry point)
- **Types**: Included in build output

## How to Contribute

### Reporting Issues

1. Check existing issues to avoid duplicates
2. Use the issue template if available
3. Include:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (Node.js version, OS, etc.)

### Feature Requests

1. Search existing issues for similar requests
2. Describe the feature and its use case
3. Consider providing a design proposal or mockup

### Pull Requests

1. **Before starting work on a large feature, please open an issue to discuss it**
2. Make sure your changes are covered by tests
3. Follow the existing code style (enforced by Biome)
4. Write clear commit messages
5. Update documentation if needed

#### Pull Request Process

1. Fork and create a feature branch
2. Write your code and tests
3. Run the full test suite: `pnpm test`
4. Run code quality checks: `pnpm check`
5. Check for secrets: `pnpm secretlint`
6. Check spelling: `pnpm cspell`
7. Set up git hooks: `npx simple-git-hooks` (first time only)
7. Commit your changes with a clear message
8. Push to your fork and create a pull request

#### Commit Message Format

We use conventional commit messages:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
- `feat(generators): add support for new AI tool`
- `fix(parser): handle missing frontmatter gracefully`
- `docs(readme): update installation instructions`

## Code Style

We use multiple linting tools for comprehensive code quality:

**Primary Tools:**
- **[Biome](https://biomejs.dev/)**: Main linter and formatter
- **[Oxlint](https://oxc.rs/)**: Fast Rust-based linter for additional checks
- **ESLint**: Additional linting with custom plugins (zod-import, no-type-assertion)

**Code Style:**
- 2 spaces for indentation
- Semicolons required
- Double quotes for strings
- Trailing commas in multi-line objects/arrays

The style is automatically enforced by our CI pipeline and pre-commit hooks.

## Testing

The project uses Vitest for testing with comprehensive coverage:

### Test Structure

- **Unit tests**: Individual function testing
- **Integration tests**: Command and generator testing  
- **Mocking**: Uses Vitest's built-in mocking capabilities
- **Coverage target**: 80%+

### Writing Tests

- Write tests for new features and bug fixes
- Use descriptive test names
- Test both success and error cases  
- Keep tests focused and isolated
- Follow the pattern: `src/module.ts` → `src/module.test.ts`

### Running Tests

```bash
# All tests
pnpm test

# Watch mode for development
pnpm test:watch

# Generate coverage report
pnpm test:coverage

# Run specific test file
pnpm test src/generators/copilot.test.ts

# Run tests for specific functionality
pnpm test src/cli/commands/import.test.ts  # Test import functionality
pnpm test src/parsers/                     # Test all parsers
```

### Test Coverage by Module

- **cli/commands**: Excellent coverage
- **core**: High coverage achieved
- **generators**: High coverage across all modules
- **parsers**: Good coverage across all parsers
- **utils**: High coverage across all modules
- **types**: Type definition files (not measured)

### Recent Improvements

- **Simplified Architecture**: Removed 5 specialized .rulesync rule files to streamline project structure
- **Enhanced Frontmatter**: Updated init-rulesync command with comprehensive frontmatter specification
- **Expanded Tool Support**: Added support for AugmentCode, JetBrains Junie, Kiro IDE, and OpenAI Codex CLI
- **Advanced MCP Integration**: Complete MCP (Model Context Protocol) support with wrapper server configurations, multiple transport types (stdio, SSE, HTTP), and environment variable handling
- **Hierarchical Rule System**: Support for multi-level rule precedence (global → project → directory) as implemented in OpenAI Codex CLI
- **Serial Execution**: Changed research-tool-specs command from parallel to serial execution for better stability
- **Improved Organization**: Reorganized generators into rules/, mcp/, and ignore/ subdirectories
- **Enhanced Testing**: Comprehensive test coverage across all modules with co-located test files (1,200+ lines of test code for new tools)
- **Type Safety**: Improved type safety with Zod schemas and proper type guards
- **Development Tooling**: Added Oxlint for additional code quality checks alongside Biome and ESLint

## Adding New AI Tools

To add support for a new AI tool (see the recent additions of `augmentcode`, `junie`, `kiro`, `codexcli` as references):

1. **Create generators**: Add files in appropriate subdirectories:
   - `src/generators/rules/newtool.ts` (standard rules)
   - `src/generators/mcp/newtool.ts` (MCP configurations, if applicable)
   - `src/generators/ignore/newtool.ts` (ignore files, if applicable)
   
   **Implementation Notes for MCP generators**:
   - Use `shared-factory.ts` for consistent MCP configuration generation
   - Support multiple transport types: stdio (command-based), SSE, HTTP
   - Handle environment variable expansion for API keys
   - Follow wrapper server patterns for third-party integrations
2. **Create parser**: Add `src/parsers/newtool.ts` for import functionality
3. **Implement interfaces**: Export async functions following the established patterns
4. **Add to core**: Update `src/core/generator.ts` and `src/core/importer.ts`
5. **Add CLI options**: Update `src/cli/index.ts` for both generate and import commands
6. **Update types**: Add to `ALL_TOOL_TARGETS` in `src/types/tool-targets.ts`
7. **Update config**: Add output path in `src/utils/config.ts`
8. **Add tests**: Create comprehensive test files for all generators and parsers
   - Aim for 250-350+ lines per test file for thorough coverage
   - Test all transport types for MCP generators
   - Include integration tests for parser functionality
   - Update shared factory tests when modifying ignore patterns
9. **Update docs**: Add to README.md and README.ja.md
10. **Add specifications**: Create rule specification files in `.rulesync/` directory
    - `specification-[tool]-rules.md`: Tool-specific rule format and file hierarchy
    - `specification-[tool]-mcp.md`: MCP server configuration specification
    - `specification-[tool]-ignore.md`: Ignore file patterns and behavior

### Generator Interface Pattern

```typescript
export async function generateNewToolConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];
  
  for (const rule of rules) {
    const content = generateNewToolMarkdown(rule);
    const outputDir = baseDir ? join(baseDir, config.outputPaths.newtool) : config.outputPaths.newtool;
    const filepath = join(outputDir, `${rule.filename}.ext`);
    
    outputs.push({
      tool: "newtool",
      filepath,
      content,
    });
  }
  
  return outputs;
}
```

### Parser Interface Pattern

```typescript
export async function parseNewToolConfiguration(
  baseDir: string = process.cwd()
): Promise<{ rules: ParsedRule[]; errors: string[] }> {
  const rules: ParsedRule[] = [];
  const errors: string[] = [];
  
  // Check for configuration files
  const configFiles = await findNewToolConfigFiles(baseDir);
  
  if (configFiles.length === 0) {
    errors.push("No NewTool configuration files found");
    return { rules, errors };
  }
  
  // Parse each configuration file
  for (const configFile of configFiles) {
    try {
      const content = await readFile(configFile, "utf-8");
      const parsed = await parseNewToolFormat(content);
      rules.push({
        ...parsed,
        filename: generateUniqueFilename("newtool", parsed),
      });
    } catch (error) {
      errors.push(`Failed to parse ${configFile}: ${error.message}`);
    }
  }
  
  return { rules, errors };
}
```

## Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for new functions/classes
- Update README.md for API changes
- Include examples in documentation

## Security

- Never commit secrets, API keys, or personal information
- Use `pnpm secretlint` to check for potential secrets
- Report security issues privately to the maintainers

## Questions?

Feel free to:
- Open an issue for questions about contributing
- Start a discussion for broader topics
- Reach out to maintainers for guidance

Thank you for contributing to rulesync!
