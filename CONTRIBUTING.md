# Contributing to rulesync

We welcome contributions to rulesync! This document outlines the process for contributing and how to get started.

## Project Overview

rulesync is a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

### Supported AI Tools

rulesync now supports **19+ AI development tools** with comprehensive rule, MCP, and ignore/permission file generation:

**Core AI Development Tools:**
- **GitHub Copilot** - Custom Instructions (`.github/copilot-instructions.md` + `.github/instructions/`)
- **Cursor** - Project Rules (4 rule types: always, manual, specificFiles, intelligently + custom commands)
- **Cline** - Rules & Instructions (`.cline/instructions.md` + `.clinerules/`)
- **Claude Code** - Memory System (`CLAUDE.md` + `.claude/memories/` + custom slash commands)
- **Amazon Q Developer CLI** - Rules & Context (`.amazonq/rules/*.md` + MCP + built-in commands)
- **Windsurf** - AI Code Editor (`.windsurf/rules/` + MCP + ignore files)

**Specialized AI Tools:**
- **OpenCode** - 🔐 **Permission-based Security** (`AGENTS.md` + `opencode.json` with granular permissions)
- **OpenAI Codex CLI** - **Advanced File Splitting** (`AGENTS.md` + XML document references + `.codex/memories/`)
- **AugmentCode** - IDE Integration (`.augment/rules/` + current & legacy formats)
- **Roo Code** - VSCode Extension (`.roo/instructions.md` + `.roo/rules/`)
- **Gemini CLI** - Google AI (`GEMINI.md` + `.gemini/memories/` + custom commands)
- **Qwen Code** - Qwen Models (`QWEN.md` + `.qwen/memories/` + git-aware filtering)

**IDE-Integrated AI:**
- **JetBrains Junie** - IntelliJ Family (`.junie/guidelines.md`)
- **Kiro IDE** - AWS IDE (`.kiro/steering/` + custom steering documents)

**Standardized Formats:**
- **AgentsMd** - Universal Format (`AGENTS.md` + `.agents/memories/`)
- **AugmentCode Legacy** - Backward Compatibility (`.augment-guidelines` format)

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/rulesync.git`
3. Install dependencies: `pnpm install`
4. Set up git hooks: `npx simple-git-hooks`
5. Create a new branch: `git checkout -b feature/your-feature-name`

**Adding Support for New AI Tools**: See the standardized **[9-step workflow](./add-support.md)** for adding new AI development tools to rulesync.

## Development Setup

### Prerequisites

- Node.js 20+ (required, recommended: 24+)
- pnpm (recommended) or npm/yarn
- Git for version control

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

# Update version (for maintainers)
pnpm prepare
```

## Project Architecture

### .rulesync Directory Structure

Starting from v0.62.0, the project supports two directory structures for better organization:

#### Recommended Structure (v0.62.0+)
```
.rulesync/
├── rules/                                # Organized rule files (recommended)
│   ├── overview.md                       # Project overview and architecture (root: true)
│   ├── my-instructions.md                # Custom project instructions
│   ├── precautions.md                   # Development precautions and guidelines
│   └── specification-[tool]-[type].md   # Tool-specific specifications
└── ...                                   # Other configuration files
```

#### Legacy Structure (backward compatible)
```
.rulesync/
├── overview.md                           # Project overview and architecture (root: true)
├── my-instructions.md                    # Custom project instructions
├── precautions.md                       # Development precautions and guidelines
└── specification-[tool]-[type].md       # Tool-specific specifications
    # Types: rules, mcp, ignore
    # Tools: augmentcode, claudecode, cline, codexcli, copilot, cursor,
    #        geminicli, junie, kiro, opencode, roo, windsurf
```

**Directory Structure Selection:**
- **New projects**: Automatically use the recommended `.rulesync/rules/` structure
- **Existing projects**: Continue using legacy structure or migrate as needed
- **CLI options**: Use `--legacy` flag for init, add, and import commands to use legacy structure
- **Configuration**: Set `config.legacy: true` in `rulesync.config.js` for project-wide legacy mode

**Comprehensive Specifications**: Each AI tool has detailed specifications covering:
- **Rules format**: File structure, frontmatter (now optional with defaults), hierarchy patterns
- **MCP configuration**: Server setup, transport types, environment handling
- **Ignore patterns**: Security-focused exclusions and file access control

**Recent Major Updates**:
- **v0.59.0**: New `--targets` flag as primary interface with backward compatibility
- **v0.62.0**: New organized directory structure (`.rulesync/rules/`) with backward compatibility
- **v0.56.0**: Optional frontmatter with sensible defaults
- **Registry Pattern**: Unified generator architecture for easier tool addition
- **Enhanced CLI**: Improved error messages, validation, and user experience
- **🔐 OpenCode Support**: Revolutionary permission-based configuration system - Uses granular read/write/execute permissions instead of traditional ignore files, providing superior security and flexibility
- **Enhanced Windsurf Support**: Complete integration with activation modes and output formats
- **Amazon Q Developer CLI Support**: Complete integration with context management, MCP configuration, and built-in slash commands
- **Legacy Support**: Full backward compatibility with existing `.rulesync/.md` layouts

### Core Architecture - Registry Pattern Implementation

The project has been **refactored using registry patterns** for improved maintainability and easier tool addition:

```
rulesync/
├── src/
│   ├── cli/
│   │   ├── commands/                    # CLI command implementations (fully tested)
│   │   │   ├── init.ts                 # Initialize project with comprehensive rule templates
│   │   │   ├── add.ts                  # Add new rule files interactively
│   │   │   ├── generate.ts             # Generate configurations (registry-driven)
│   │   │   ├── import.ts               # Import existing configurations (enhanced with command detection)
│   │   │   ├── watch.ts                # Real-time file watching
│   │   │   ├── status.ts               # Project status and health checks
│   │   │   ├── validate.ts             # Rule validation with detailed reporting
│   │   │   ├── gitignore.ts            # Smart .gitignore management
│   │   │   └── config.ts               # Configuration management
│   │   ├── utils/                      # ⭐ NEW: CLI utility functions
│   │   │   └── targets-parser.ts       # Target specification parsing with validation
│   │   └── index.ts                   # CLI entry point (Commander.js)
│   ├── utils/
│   │   ├── feature-validator.ts        # ⭐ NEW: Feature validation and normalization
│   │   └── [other utils]               # Existing utility functions
│   ├── core/
│   │   ├── parser.ts                  # Parse .rulesync/*.md files
│   │   ├── generator.ts               # Orchestrate generation (registry-aware)
│   │   ├── importer.ts                # Import existing configurations (enhanced)
│   │   ├── validator.ts               # Comprehensive rule validation
│   │   ├── mcp-generator.ts           # MCP-specific generation with factory pattern
│   │   ├── mcp-parser.ts              # MCP configuration parsing
│   │   ├── command-generator.ts       # ⭐ NEW: Orchestrate custom command generation
│   │   └── command-parser.ts          # ⭐ NEW: Parse command definitions from rules
│   └── xml-document-generator.ts   # ⭐ NEW: XML document reference system for file splitting
│   ├── generators/                    # Organized by output type with shared patterns
│   │   ├── rules/                     # Standard rule generators
│   │   │   ├── generator-registry.ts  # ⭐ NEW: Registry pattern for rule generation
│   │   │   ├── shared-helpers.ts      # ⭐ NEW: Shared generation utilities
│   │   │   ├── augmentcode.ts         # AugmentCode Rules (current + legacy)
│   │   │   ├── amazonqcli.ts          # Amazon Q Developer CLI (.amazonq/rules/ + context management + built-in commands)
│   │   │   ├── claudecode.ts          # Claude Code Memory (complex hierarchy)
│   │   │   ├── cline.ts               # Cline Rules (.cline/instructions.md)
│   │   │   ├── codexcli.ts            # OpenAI Codex CLI (AGENTS.md + XML-based file splitting + memory files)
│   │   │   ├── copilot.ts             # GitHub Copilot (.github/copilot-*.md)
│   │   │   ├── cursor.ts              # Cursor Rules (4 activation types)
│   │   │   ├── geminicli.ts           # Gemini CLI (GEMINI.md + memories)
│   │   │   ├── junie.ts               # JetBrains Junie (.junie/guidelines.md)
│   │   │   ├── kiro.ts                # Kiro IDE Custom Steering Documents
│   │   │   ├── opencode.ts            # 🔐 OpenCode (AGENTS.md + permission-based opencode.json)
│   │   │   ├── roo.ts                 # Roo Code Rules (.roo/instructions.md)
│   │   │   └── windsurf.ts            # ⭐ NEW: Windsurf (.windsurf/rules/ + memories)
│   │   ├── mcp/                       # MCP configuration generators
│   │   │   ├── shared-factory.ts      # ⭐ NEW: Shared MCP configuration factory
│   │   │   └── [tool].ts              # Individual MCP generators (11 tools)
│   │   ├── ignore/                    # Ignore file generators
│   │       ├── shared-factory.ts      # ⭐ NEW: Shared ignore file factory
│   │       ├── shared-helpers.ts      # ⭐ NEW: Common ignore pattern utilities
│   │       └── [tool].ts              # Security-focused ignore generators (Note: OpenCode uses permissions)
│   │   └── commands/                  # ⭐ NEW: Custom command generators
│   │       ├── cursor.ts              # Cursor command generation
│   │       ├── cline.ts               # Cline command generation
│   │       ├── roo.ts                 # Roo Cline command generation
│   │       └── windsurf.ts            # Windsurf command generation
│   ├── parsers/                       # Tool-specific parsers (comprehensive coverage)
│   │   ├── shared-helpers.ts          # ⭐ NEW: Shared parsing utilities
│   │   ├── augmentcode.ts             # Parse AugmentCode (.augmentcode + legacy)
│   │   ├── claudecode.ts              # Parse Claude Code (CLAUDE.md + memories)
│   │   ├── cline.ts                   # Parse Cline (.cline/instructions.md)
│   │   ├── codexcli.ts                # Parse Codex CLI (AGENTS.md + memory files)
│   │   ├── copilot.ts                 # Parse GitHub Copilot (.github/copilot-*.md)
│   │   ├── cursor.ts                  # Parse Cursor (.cursorrules + .cursor/rules/*.mdc)
│   │   ├── geminicli.ts               # Parse Gemini CLI (GEMINI.md + memories)
│   │   ├── junie.ts                   # Parse Junie (.junie/guidelines.md)
│   │   ├── opencode.ts                # Parse OpenCode (AGENTS.md + permission-based opencode.json)
│   │   ├── roo.ts                     # Parse Roo (.roo/instructions.md)
│   │   └── windsurf.ts                # ⭐ NEW: Parse Windsurf (.windsurf/rules/)
│   ├── types/                         # Enhanced TypeScript definitions
│   │   ├── config.ts                  # Configuration types
│   │   ├── rules.ts                   # Rule and frontmatter types (extended)
│   │   ├── mcp.ts                     # MCP-specific types
│   │   ├── mcp-config.ts              # ⭐ NEW: MCP configuration types
│   │   ├── claudecode.ts              # ⭐ NEW: Claude Code specific types
│   │   ├── commands.ts                # ⭐ NEW: Custom command types and interfaces
│   │   ├── tool-targets.ts            # Updated tool target definitions (11 tools)
│   │   └── config-options.ts          # ⭐ NEW: Configuration option types with FeatureType support
│   ├── test-utils/                    # ⭐ NEW: Shared testing utilities
│   │   ├── index.ts                   # Common test helpers
│   │   ├── mock-config.ts             # Mock configuration factory
│   │   └── mock-helpers.ts            # Mock data generators
│   └── utils/
│       ├── file.ts                    # File operations (enhanced error handling)
│       ├── config.ts                  # Configuration management (extended)
│       ├── config-loader.ts           # Multi-format configuration loading
│       ├── ignore.ts                  # Ignore file utilities
│       ├── rules.ts                   # Rule processing utilities
│       ├── mcp-helpers.ts             # ⭐ NEW: MCP-specific utilities
│       ├── parser-helpers.ts          # Parser utility functions
│       ├── xml-document-generator.ts  # ⭐ NEW: XML document reference generation for file splitting
│       └── error.ts                   # ⭐ NEW: Enhanced error handling
├── dist/                              # Build output (CJS + ESM + types)
└── **/*.test.ts                       # Co-located test files (1,500+ lines)
```

### Frontmatter Schema Changes (v0.56.0)

**Breaking Change**: All frontmatter fields are now optional with automatic default values:

```typescript
// Before v0.56.0 (required fields)
export const RuleFrontmatterSchema = z.object({
  root: z.boolean(),                    // Required
  targets: RulesyncTargetsSchema,       // Required
  description: z.string(),              // Required
  globs: z.array(z.string()),          // Required
});

// v0.56.0+ (optional with defaults)
export const RuleFrontmatterSchema = z.object({
  root: z.optional(z.boolean()),        // Default: false
  targets: z.optional(RulesyncTargetsSchema), // Default: ["*"]
  description: z.optional(z.string()),  // Default: generated from filename
  globs: z.optional(z.array(z.string())), // Default: ["**/*"]
  // New optional fields:
  windsurfActivationMode: z.optional(z.enum(["always", "manual", "model-decision", "glob"])),
  windsurfOutputFormat: z.optional(z.enum(["single-file", "directory"])),
  tags: z.optional(z.array(z.string())),
});
```

**Impact on Development**:
- Rule files can now have minimal or no frontmatter
- Default values are applied during parsing phase
- Backward compatibility maintained for existing rule files
- Enhanced validation with clear error messages

### Import Command Technical Enhancements (ENHANCED)

The `import` command has been significantly improved to handle the expanded rulesync ecosystem and new command generation features:

#### Enhanced Import Capabilities

1. **Command Detection and Import**
   - Automatically detects existing commands in imported configurations
   - Extracts command definitions from tool-specific formats
   - Converts to unified command frontmatter format
   - Preserves keyboard shortcuts and metadata

2. **Improved Tool Discovery**
   - Enhanced detection patterns for all 12 supported AI tools
   - Better handling of hierarchical configurations (Claude Code, Codex CLI)
   - Support for multi-file patterns (Windsurf, Cursor)
   - MCP configuration detection and import

3. **Advanced Configuration Parsing**
   - Robust parsing of complex configuration formats
   - Error recovery for malformed configurations
   - Metadata preservation during import process
   - Frontmatter standardization across tools

#### Import Process Flow

```typescript
// Enhanced import workflow
async function importConfigurations(tools: string[], options: ImportOptions) {
  for (const tool of tools) {
    // 1. Discover existing configurations
    const configs = await discoverToolConfigurations(tool);
    
    // 2. Parse configurations with command extraction
    const parsed = await parseConfigurationsWithCommands(configs);
    
    // 3. Convert to unified rule format
    const rules = await convertToUnifiedFormat(parsed);
    
    // 4. Generate rulesync-compatible files
    await generateRulesyncFiles(rules, tool);
  }
}
```

#### Testing Import Enhancements

```bash
# Test import command with command detection
pnpm test src/core/importer               # Core import logic
pnpm test src/cli/commands/import         # CLI import command
pnpm test src/parsers/                    # All tool parsers

# Test specific tool imports with commands
pnpm test:import cursor                   # Test Cursor import with commands
pnpm test:import cline                    # Test Cline import
pnpm test:import roo                      # Test Roo Cline import
pnpm test:import codexcli                 # Test CodexCLI XML-based import

# Integration testing
pnpm test:e2e import                      # End-to-end import testing
```

#### Testing File Splitting Features

```bash
# Test file splitting core functionality
pnpm test src/utils/xml-document-generator  # XML document reference generation
pnpm test src/generators/rules/codexcli     # CodexCLI file splitting implementation
pnpm test src/parsers/codexcli              # CodexCLI XML parsing and import

# Test XML document generation
pnpm test src/generators/rules/shared-helpers # Test generateComplexRules function

# Integration testing for file splitting
pnpm dev generate --target codexcli --verbose # Test with detailed output
```

### Custom Command Generation Architecture (NEW)

The project now includes a **custom command generation system** that allows AI tools to register and execute custom commands defined in rule files. This feature is currently supported for tools that have command execution capabilities:

#### Core Components

1. **CommandParser (`src/core/command-parser.ts`)**
   - Extracts command definitions from rule frontmatter
   - Validates command syntax and structure
   - Supports inline commands and command blocks
   - Handles command metadata including description and keybindings
   - Example frontmatter:
     ```yaml
     commands:
       - name: "test"
         description: "Run project tests"
         content: "npm test"
         key: "t"  # Optional keyboard shortcut
       - name: "build"
         description: "Build the project for production"
         content: |
           npm run clean
           npm run compile
           npm run bundle
         key: "b"
     ```

2. **CommandGenerator (`src/core/command-generator.ts`)**
   - Orchestrates command generation across supported tools
   - Routes to appropriate tool-specific generators
   - Handles command file creation and formatting
   - Manages command registration and deduplication
   - Integrates with rule processing pipeline

3. **Tool-Specific Command Generators (`src/generators/commands/`)**
   - **cursor.ts**: Generates Cursor commands with inline integration
   - **cline.ts**: Creates Cline-compatible command instructions
   - **roo.ts**: Produces Roo Cline trigger definitions with keybindings
   - **windsurf.ts**: Generates Windsurf command configurations

#### Command Definition Format

Commands are defined in rule frontmatter using the following structure:

```typescript
interface CommandDefinition {
  name: string;        // Command identifier (unique within scope)
  description: string; // Human-readable description
  content: string;     // Command script (single or multi-line)
  key?: string;        // Optional keyboard shortcut (tool-specific)
}
```

#### Generator Pattern

Each tool's command generator follows this pattern:

```typescript
export async function generateToolCommands(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  // 1. Extract commands from rules
  const commands = CommandParser.extractCommands(rules);
  
  // 2. Format commands for the specific tool
  const formattedCommands = formatCommandsForTool(commands);
  
  // 3. Generate output file(s)
  return [{
    path: getCommandFilePath(config, baseDir),
    content: formattedCommands
  }];
}
```

#### Testing Command Generation

Command generation includes comprehensive test coverage:

```bash
# Test command parsing and validation
pnpm test src/core/command-parser

# Test command generation orchestration
pnpm test src/core/command-generator

# Test all tool-specific command generators
pnpm test src/generators/commands/

# Test individual tool command generation
pnpm test src/generators/commands/cursor    # Cursor command integration
pnpm test src/generators/commands/cline     # Cline instruction generation
pnpm test src/generators/commands/roo       # Roo Cline trigger definitions
pnpm test src/generators/commands/windsurf  # Windsurf command configuration

# Test command integration in rule processing
pnpm test src/core/generator.integration   # End-to-end with commands

# Test directory structure compatibility
pnpm test src/cli/commands/init.legacy     # Test legacy initialization
pnpm test src/cli/commands/import.legacy   # Test legacy import mode
pnpm test src/utils/config.legacy          # Test legacy configuration

# Test command generation in development environment
pnpm dev generate --targets cursor --commands  # Include command generation
pnpm dev generate --targets cline --commands   # Test with Cline
pnpm dev generate --targets roo --commands     # Test with Roo Cline
pnpm dev generate --targets windsurf --commands # Test with Windsurf

# Test new targets syntax
pnpm dev generate --targets *                 # All tools
pnpm dev generate --targets copilot,cursor    # Multiple specific tools
pnpm dev generate --targets claudecode        # Single tool

# Test file splitting functionality
pnpm test src/generators/rules/codexcli       # Test CodexCLI file splitting
pnpm test src/utils/xml-document-generator    # Test XML document generation
pnpm dev generate --targets codexcli          # Test CodexCLI generation with file splitting

# Test targets parser functionality
pnpm test src/cli/utils/targets-parser        # Test target parsing logic
pnpm test src/cli/commands/generate           # Test generate command with new syntax

# Test features system
pnpm test src/utils/feature-validator         # Feature validation and normalization
pnpm test src/cli/commands/generate-features  # Features integration testing
pnpm test src/types/config-options            # Feature type definitions and schemas

# Test with legacy structure
pnpm dev init --legacy                      # Test legacy initialization
pnpm dev add typescript-rules --legacy      # Test legacy rule addition
pnpm dev import --cursor --legacy           # Test legacy import

# Test features option
pnpm dev generate --targets * --features rules          # Test rules-only generation
pnpm dev generate --targets cursor --features rules,mcp # Test selective features
pnpm dev generate --targets * --features *              # Test all features explicitly
```

#### Adding Command Support to New Tools

To add command support for a new AI tool:

1. **Check Tool Capabilities**: Verify the tool supports custom command execution
2. **Create Command Generator**: Add `src/generators/commands/newtool.ts`
3. **Define Output Format**: Determine how the tool expects commands to be formatted
4. **Register in CommandGenerator**: Add to the tool switch in `command-generator.ts`
5. **Add Types**: Update `src/types/commands.ts` if needed
6. **Write Tests**: Create comprehensive tests for the new generator
7. **Update Documentation**: Document the command format in tool specification
8. **Integration Testing**: Test command generation with the actual AI tool

Example implementation:
```typescript
// src/generators/commands/newtool.ts
export async function generateNewToolCommands(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  const commands = CommandParser.extractCommands(rules);
  
  if (commands.length === 0) {
    return [];
  }
  
  const content = formatNewToolCommands(commands);
  const outputPath = join(
    baseDir ?? config.outputDirectory ?? process.cwd(),
    ".newtool",
    "commands.json"
  );
  
  return [{
    path: outputPath,
    content: JSON.stringify(content, null, 2)
  }];
}
```

### Key Dependencies

#### Core Dependencies
- **Commander.js**: CLI framework for command-line interface and argument parsing
- **gray-matter**: Frontmatter parsing for Markdown files (supports YAML, TOML, JSON)
- **marked**: Markdown parsing and rendering for content processing
- **chokidar**: File watching for `watch` command with high performance
- **c12**: Configuration loading with support for multiple formats (JSON, JSONC, TS)
- **micromatch**: Glob pattern matching for file filtering and rule targeting
- **zod**: Runtime type validation and schema definition with enhanced command types
- **js-yaml**: YAML parsing and stringification for frontmatter and configuration

#### Development and Build
- **tsup**: Build system (outputs both CJS and ESM with type definitions)
- **tsx**: TypeScript execution for development and testing
- **Biome**: Unified linter and formatter (primary tool)
- **ESLint**: Additional linting with custom plugins (zod-import, no-type-assertion)
- **Oxlint**: Fast Rust-based linter for additional checks
- **Vitest**: Testing framework with coverage and snapshot testing
- **cspell**: Spell checker for code and documentation

#### File Splitting Dependencies
- **fast-xml-parser**: XML document reference generation and parsing
- **XMLBuilder**: Structured XML output for document references
- **Path resolution utilities**: Dynamic path resolution for memory file references
- **Directory management**: Auto-creation of memory file directories

#### Command Generation Dependencies
- **Command parsing utilities**: Enhanced frontmatter handling for command definitions
- **Tool-specific formatters**: Custom formatting for each AI tool's command format
- **Validation helpers**: Command schema validation and error reporting
- **Template engines**: Dynamic command file generation with metadata preservation

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
2. Write your code and tests (including command generation if applicable)
3. Test directory structure support: `pnpm test:directory-structure` (if applicable)
4. Run the full test suite: `pnpm test`
5. Run code quality checks: `pnpm check`
6. Check for secrets: `pnpm secretlint`
7. Check spelling: `pnpm cspell`
8. Test command generation functionality if applicable: `pnpm test src/generators/commands/`
9. Set up git hooks: `npx simple-git-hooks` (first time only)
10. Commit your changes with a clear message
11. Push to your fork and create a pull request

#### Development Workflow for File Splitting Features

When working on file splitting functionality:

1. **XML Structure Design**: Define XML document reference structure for the target tool
2. **Memory File Organization**: Plan directory structure and file naming conventions
3. **Generator Implementation**: Use `generateComplexRules` helper with appropriate configuration
4. **XML Generation**: Implement XML document references using `generateRootMarkdownWithXmlDocs`
5. **Parser Integration**: Add XML parsing support for import functionality
6. **Test Coverage**: Cover root/memory file generation, XML structure, and directory creation
7. **Gitignore Integration**: Ensure memory directories are excluded from version control
8. **Documentation**: Update specifications with file splitting architecture details

#### Development Workflow for Command Features

When working on command generation features:

1. **Design Command Format**: Define how commands should be represented for the target tool
2. **Implement Parser**: Add command detection to the tool's parser if importing is needed
3. **Create Generator**: Implement the command generator following the established pattern
4. **Add Validation**: Ensure command definitions are properly validated
5. **Test Directory Structures**: Ensure commands work with both recommended and legacy directory layouts
6. **Write Tests**: Cover parsing, generation, validation, and error scenarios
7. **Integration Testing**: Test with real AI tool configurations
8. **Documentation**: Update tool specifications with command format details

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
- `feat(commands): add command generation for Cursor integration`
- `feat(structure): add organized directory support with legacy compatibility`
- `fix(parser): handle missing frontmatter gracefully`
- `fix(commands): resolve command deduplication issue`
- `fix(legacy): ensure backward compatibility for existing projects`
- `enhance(import): improve command detection during import`
- `docs(readme): update installation instructions`
- `test(commands): add comprehensive command generation tests`
- `test(structure): add directory structure compatibility tests`

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

The project uses Vitest for comprehensive testing with **1,500+ lines of test code** across all modules:

### Test Architecture

- **Co-located tests**: Each module has its corresponding `.test.ts` file
- **Shared test utilities**: `src/test-utils/` provides common helpers and mocks
- **Registry pattern testing**: Tests validate both individual tools and shared factories
- **Comprehensive coverage**: 250-350 lines per AI tool with extensive scenario testing

### Test Structure & Standards

#### Unit Tests
- **Individual function testing** with isolated scope
- **Error handling validation** for all edge cases
- **Type safety verification** with TypeScript strict mode

#### Integration Tests
- **End-to-end command testing** (init, generate, import, validate)
- **Multi-tool generation workflows** (rules + MCP + ignore files)
- **File system operations** with temporary directories

#### Tool-Specific Test Patterns
Each AI tool follows this comprehensive test structure:

```typescript
// Example: src/generators/rules/windsurf.test.ts (350+ lines)
describe("generateWindsurfConfig", () => {
  // Basic functionality
  it("should generate directory variant by default")
  it("should generate single-file variant when specified")
  
  // Frontmatter handling
  it("should handle activation modes correctly")
  it("should process glob patterns for activation")
  
  // Path resolution
  it("should resolve paths correctly for different variants")
  it("should handle base directory overrides")
  
  // Error scenarios
  it("should handle missing frontmatter gracefully")
  it("should validate required fields")
  
  // Advanced features
  it("should support multiple activation modes")
  it("should integrate with ignore file generation")
});
```

### Writing Tests - Registry Pattern

#### Testing Registry-Based Generators
```typescript
import { generateFromRegistry } from "../rules/generator-registry.js";

it("should generate using registry for simple tools", async () => {
  const outputs = await generateFromRegistry("newtool", rules, config);
  expect(outputs).toMatchExpectedStructure();
});
```

#### Testing Shared Factories
```typescript
import { generateIgnoreFile, ignoreConfigs } from "../ignore/shared-factory.js";

it("should generate security-focused ignore patterns", async () => {
  const outputs = generateIgnoreFile(rules, config, ignoreConfigs.newtool);
  expect(outputs[0].content).toContain("# Security & Credentials");
});
```

### Running Tests

```bash
# All tests with coverage
pnpm test
pnpm test:coverage

# Development with watch mode
pnpm test:watch

# Specific test categories
pnpm test src/generators/                  # All generator tests
pnpm test src/parsers/                     # All parser tests  
pnpm test src/generators/rules/windsurf    # Windsurf rule generator
pnpm test src/generators/mcp/              # All MCP generators
pnpm test src/generators/ignore/           # All ignore generators

# Integration tests
pnpm test src/core/generator.integration   # End-to-end generation
pnpm test src/cli/commands/                # CLI command testing

# Command generation tests
pnpm test src/core/command-parser          # Command parsing logic
pnpm test src/core/command-generator       # Command generation orchestration
pnpm test src/generators/commands/         # All command generators
```

### Test Coverage Expectations

**Current Coverage by Module** (Target: 80%+):

- **cli/commands**: **Excellent** - All commands fully tested with edge cases
- **core**: **High** - Parser, generator, importer, validator, command-parser, command-generator extensively tested
- **generators/rules**: **High** - All 11 tools with 250-350 lines each
- **generators/mcp**: **High** - All transport types and configurations
- **generators/ignore**: **High** - Security patterns and factory functions
- **generators/commands**: **High** - Command generation for supported tools (Cursor, Cline, Roo, Windsurf)
- **parsers**: **High** - Discovery patterns and error handling for all tools
- **utils**: **High** - File operations, config loading, error handling
- **test-utils**: **Full** - Mock factories and shared helpers
- **types**: Type definitions (not measured, but validated by TypeScript)

### Advanced Testing Scenarios

#### MCP Configuration Testing
```typescript
// Test all transport types
it("should support stdio transport", async () => { /* ... */ });
it("should support SSE transport", async () => { /* ... */ });
it("should support HTTP transport", async () => { /* ... */ });

// Test environment variable handling
it("should expand environment variables", async () => { /* ... */ });
it("should handle missing environment variables", async () => { /* ... */ });
```

#### Security-Focused Ignore Pattern Testing
```typescript
it("should include critical security exclusions", async () => {
  expect(content).toContain("*.pem");
  expect(content).toContain("*.key");
  expect(content).toContain(".env*");
});

it("should include tool-specific patterns", async () => { /* ... */ });
it("should support pattern re-inclusion with negation", async () => { /* ... */ });
```

#### Parser Discovery Testing
```typescript
it("should discover hierarchical configurations", async () => { /* ... */ });
it("should handle multi-file patterns", async () => { /* ... */ });
it("should validate frontmatter during parsing", async () => { /* ... */ });
```

#### Command Generation Testing
```typescript
// Test command extraction from frontmatter
it("should extract commands from rule frontmatter", async () => {
  const commands = CommandParser.extractCommands(rules);
  expect(commands).toHaveLength(3);
  expect(commands[0]).toHaveProperty("name");
  expect(commands[0]).toHaveProperty("description");
  expect(commands[0]).toHaveProperty("content");
  expect(commands[0]).toHaveProperty("key"); // Optional keyboard shortcut
});

// Test multi-line command handling
it("should handle multi-line command scripts", async () => { /* ... */ });

// Test command validation
it("should validate command definitions", async () => {
  // Test required fields, unique names, valid keys
});

// Test command deduplication
it("should deduplicate commands with same name", async () => { /* ... */ });

// Test tool-specific formatting
it("should format commands for Cursor's embedded format", async () => { /* ... */ });
it("should generate Cline's command instructions", async () => { /* ... */ });
it("should create Roo's trigger definitions with keybindings", async () => { /* ... */ });
it("should produce Windsurf's command markdown", async () => { /* ... */ });

// Test error handling
it("should handle invalid command definitions gracefully", async () => { /* ... */ });
it("should report parsing errors with helpful messages", async () => { /* ... */ });
```

### Major Architecture Improvements

**Registry Pattern Implementation**:
- **Generator Registry**: `generator-registry.ts` eliminates boilerplate code for new AI tools
- **Shared Factories**: Consistent MCP config and ignore file generation across tools
- **Reduced Duplication**: Common patterns abstracted into reusable factories

**New Windsurf AI Code Editor Support**:
- **Complete Integration**: Rules, MCP, and ignore file generation
- **Advanced Features**: Multiple activation modes (always-on, manual, model-decision, glob)
- **Flexible Output**: Single-file (`.windsurf-rules`) or directory variant (`.windsurf/rules/`)
- **Memory Integration**: Auto-generated memories and manual memory creation

**Enhanced Tool Support** (16 total tools):
- **Comprehensive Coverage**: All major AI development tools supported
- **Hierarchical Systems**: Multi-level rule precedence for complex tools (Codex CLI, Claude Code, Amazon Q CLI)
- **🔐 Revolutionary Permission System**: OpenCode introduces granular read/write/execute permissions instead of traditional ignore files - providing superior security, flexibility, and control over AI actions
- **Advanced Command Systems**: Amazon Q CLI provides comprehensive built-in slash commands and context management
- **Legacy Support**: AugmentCode legacy format maintained alongside current format
- **Security Focus**: Advanced ignore patterns and permission controls with security-first approach, with OpenCode leading innovation

**Development Quality Improvements**:
- **Comprehensive Testing**: 1,500+ lines of test code with 250-350 lines per tool
- **Type Safety**: Enhanced with Zod schemas and strict TypeScript configuration
- **Code Quality**: Triple-linter setup (Biome + ESLint + Oxlint) for comprehensive checks
- **Maintainability**: Registry patterns make adding new tools significantly easier

## Adding New AI Tools - Registry-Based Workflow

**The registry pattern makes adding new AI tools significantly easier!** Reference the recent **Windsurf integration** as a complete example.

### Step 1: Generator Implementation (Choose Approach)

#### Option A: Registry-Based (Recommended for Simple Tools)
Add configuration to `src/generators/rules/generator-registry.ts`:
```typescript
newTool: {
  type: "simple",        // or "complex" for root+detail patterns
  tool: "newtool",
  fileExtension: ".md",
  ignoreFileName: ".newtoolignore",
  generateContent: (rule) => rule.content.trim(),
  pathResolver: (rule, outputDir) => join(outputDir, `${rule.filename}.md`)
}
```

#### Option B: Custom Generator (Complex Requirements)
Create `src/generators/rules/newtool.ts` for advanced features:
- Multi-file hierarchies (like Claude Code)
- Complex frontmatter transformations (like Cursor rule types)
- Additional configuration file updates (like settings.json)

### Step 2: Supporting Infrastructure

1. **MCP Configuration** (if applicable):
   ```typescript
   // src/generators/mcp/newtool.ts
   import { generateMcpConfig } from "./shared-factory.js";
   
   export async function generateNewToolMcpConfig(/* ... */) {
     return generateMcpConfig(rules, config, {
       tool: "newtool",
       defaultServers: { /* server configs */ }
     }, baseDir);
   }
   ```

2. **Ignore File Generator** (if applicable):
   ```typescript
   // src/generators/ignore/newtool.ts
   import { generateIgnoreFile, ignoreConfigs } from "./shared-factory.js";
   
   export async function generateNewToolIgnoreFile(/* ... */) {
     return generateIgnoreFile(rules, config, ignoreConfigs.newTool, baseDir);
   }
   ```

3. **Parser Implementation**:
   ```typescript
   // src/parsers/newtool.ts - Import existing configurations
   export async function parseNewToolConfiguration(baseDir: string) {
     // Discover and parse existing tool configurations
     // Return { rules: ParsedRule[], errors: string[] }
   }
   ```

### Step 3: Integration Points

1. **Tool Target Registration**: Add to `ALL_TOOL_TARGETS` in `src/types/tool-targets.ts`
2. **Core Integration**: Update `src/core/generator.ts` and `src/core/importer.ts`
3. **CLI Integration**: Update `src/cli/index.ts` for generate/import commands
4. **Configuration**: Add output paths to `src/utils/config.ts`
5. **Directory Structure Support**: Ensure tool supports both recommended and legacy layouts
6. **Legacy Compatibility**: Test with `--legacy` flag for all applicable commands

### Step 4: Comprehensive Testing

**Expected test coverage**: 250-350 lines per tool (reference Windsurf tests):

```typescript
// src/generators/rules/newtool.test.ts
// src/generators/mcp/newtool.test.ts
// src/generators/ignore/newtool.test.ts
// src/parsers/newtool.test.ts
```

**Test scenarios to cover**:
- ✅ Basic rule generation
- ✅ Frontmatter handling and transformation
- ✅ File path resolution and directory structure
- ✅ **Directory structure compatibility** (both recommended and legacy)
- ✅ **Legacy flag support** for CLI commands
- ✅ Error handling and edge cases
- ✅ MCP transport types (stdio, SSE, HTTP)
- ✅ Ignore pattern generation and security focus
- ✅ Parser discovery and import functionality
- ✅ Integration with registry patterns

### Step 5: Documentation

1. **Specifications**: Create comprehensive specs in `.rulesync/`:
   - `specification-newtool-rules.md`: Rule format, file hierarchy, frontmatter
   - `specification-newtool-mcp.md`: MCP server setup, transport options
   - `specification-newtool-ignore.md`: Security patterns, file exclusions

2. **User Documentation**: Update README.md and README.ja.md with:
   - Tool description and supported features
   - Generated file locations and formats
   - Example usage patterns

### Registry Pattern Benefits

- **90% Less Boilerplate**: Registry handles common generation patterns
- **Consistent Behavior**: Shared factories ensure uniform output
- **Easy Maintenance**: Changes to shared patterns benefit all tools
- **Type Safety**: Strongly typed configurations prevent runtime errors
- **Comprehensive Testing**: Shared test utilities speed up test development

**Time to add a new tool**: Reduced from ~2-3 days to ~4-6 hours for simple tools!

### CLI Interface Improvements (v0.59.0 & v0.63.0)

**Enhanced Target Specification (v0.59.0):**
- **Primary Interface**: `--targets` flag replaces individual tool flags
- **Unified Syntax**: `--targets copilot,cursor,cline` instead of `--copilot --cursor --cline`
- **Wildcard Support**: `--targets *` for all tools
- **Validation**: Comprehensive input validation with helpful error messages
- **Backward Compatibility**: All legacy flags still work with deprecation warnings

**Features System (v0.63.0):**
- **Selective Generation**: `--features` flag allows choosing which types of files to generate
- **Feature Types**: `rules`, `commands`, `mcp`, `ignore` - each can be generated independently
- **Wildcard Support**: `--features *` for all features (default behavior)
- **Configuration Support**: Features can be specified in configuration files
- **Backward Compatibility**: Defaults to all features when not specified (with warning)
- **Performance**: Generate only what you need for faster execution

**Target Parser Implementation:**
```typescript
// src/cli/utils/targets-parser.ts
export function parseTargets(targetsInput: string | string[]): ToolTarget[] {
  // Parse comma-separated targets with validation
  // Handle wildcard (*) and "all" keywords
  // Validate against supported tool list
  // Provide clear error messages for invalid input
}

export function checkDeprecatedFlags(options: Record<string, unknown>): ToolTarget[] {
  // Check for deprecated individual flags
  // Return corresponding tool targets
  // Used for backward compatibility
}

export function getDeprecationWarning(deprecatedTools: ToolTarget[]): string {
  // Generate helpful migration messages
  // Show current vs. new syntax
  // Guide users to modern interface
}
```

**Feature Validator Implementation:**
```typescript
// src/utils/feature-validator.ts
export function validateFeatures(features: string[] | "*" | undefined): FeatureType[] | "*" {
  // Validate feature types against supported list
  // Handle wildcard expansion
  // Provide clear error messages for invalid features
}

export function normalizeFeatures(features: FeatureType[] | "*" | undefined): FeatureType[] {
  // Convert wildcard to full feature array
  // Always returns array for consistent processing
}

export function expandWildcard(): FeatureType[] {
  // Returns all available feature types
  // Used for wildcard expansion
}
```

**Enhanced Error Handling:**
- Clear validation messages for invalid tool names
- Clear validation messages for invalid feature types
- Prevention of conflicting target specifications
- Prevention of mixing wildcard with specific features
- Helpful migration guidance for deprecated syntax
- Backward compatibility warnings for missing features
- Improved user experience with actionable error messages
- Configuration file validation for features field

**Directory Structure Support**: All new tools automatically support both recommended (`.rulesync/rules/`) and legacy (`.rulesync/*.md`) directory structures through the registry pattern.

### Implementation Patterns

#### Registry-Based Generator (Simple Tools)
```typescript
// Add to src/generators/rules/generator-registry.ts
newtool: {
  type: "simple",
  tool: "newtool",
  fileExtension: ".md",
  ignoreFileName: ".newtoolignore",
  generateContent: (rule) => {
    // Custom content transformation
    const lines: string[] = [];
    if (rule.frontmatter.description) {
      lines.push(`# ${rule.frontmatter.description}`);
    }
    lines.push(rule.content.trim());
    return lines.join("\n");
  },
  pathResolver: (rule, outputDir) => {
    return join(outputDir, ".newtool", "rules", `${rule.filename}.md`);
  }
}
```

#### Shared Factory Usage (MCP + Ignore)
```typescript
// src/generators/mcp/newtool.ts
import { generateMcpConfig } from "./shared-factory.js";

export async function generateNewToolMcpConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  return generateMcpConfig(rules, config, {
    tool: "newtool",
    configFile: ".newtool/mcp-servers.json",
    defaultServers: {
      "newtool-server": {
        transport: "stdio",
        command: "npx",
        args: ["@newtool/mcp-server"]
      }
    },
    serverSpecificEnv: {
      "NEWTOOL_API_KEY": "API key for NewTool integration"
    }
  }, baseDir);
}

// src/generators/ignore/newtool.ts
import { generateIgnoreFile, type IgnoreFileConfig } from "./shared-factory.js";

const newtoolIgnoreConfig: IgnoreFileConfig = {
  tool: "newtool",
  filename: ".newtoolignore",
  header: [
    "# Generated by rulesync - NewTool AI ignore file",
    "# Controls which files are excluded from AI analysis"
  ],
  corePatterns: [
    "# NewTool specific exclusions",
    "*.newtool-cache",
    ".newtool-temp/"
  ],
  includeCommonPatterns: true
};

export async function generateNewToolIgnoreFile(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string
): Promise<GeneratedOutput[]> {
  return generateIgnoreFile(rules, config, newtoolIgnoreConfig, baseDir);
}
```

#### Parser Pattern with Shared Helpers
```typescript
// src/parsers/newtool.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMarkdownContent, generateUniqueFilename } from "./shared-helpers.js";

export async function parseNewToolConfiguration(
  baseDir: string = process.cwd()
): Promise<{ rules: ParsedRule[]; errors: string[] }> {
  const rules: ParsedRule[] = [];
  const errors: string[] = [];
  
  // Discover configuration files using tool-specific patterns
  const possiblePaths = [
    join(baseDir, ".newtool", "rules"),      // Directory variant
    join(baseDir, ".newtool-rules"),         // Single file variant
  ];
  
  for (const configPath of possiblePaths) {
    try {
      const configFiles = await findNewToolFiles(configPath);
      
      for (const file of configFiles) {
        const content = await readFile(file, "utf-8");
        const parsed = parseMarkdownContent(content, "newtool");
        
        rules.push({
          ...parsed,
          filename: generateUniqueFilename("newtool", parsed)
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        errors.push(`Failed to parse NewTool config at ${configPath}: ${error.message}`);
      }
    }
  }
  
  if (rules.length === 0) {
    errors.push("No NewTool configuration files found");
  }
  
  return { rules, errors };
}

async function findNewToolFiles(basePath: string): Promise<string[]> {
  // Implementation for discovering NewTool-specific files
  // Handle both single-file and multi-file patterns
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
