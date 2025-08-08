# Contributing to rulesync

We welcome contributions to rulesync! This document outlines the process for contributing and how to get started.

**English** | [日本語](./CONTRIBUTING.ja.md)

## Project Overview

rulesync is a Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

### Supported AI Tools

rulesync now supports **11 AI development tools** with comprehensive rule, MCP, and ignore file generation:

- **GitHub Copilot** Custom Instructions (.github/copilot-*.md)
- **Cursor** Project Rules (4 rule types: always, manual, specificFiles, intelligently)
- **Cline** Rules (.cline/instructions.md)
- **Claude Code** Memory (CLAUDE.md + .claude/memories/)
- **AugmentCode** Rules (current + legacy formats)
- **Roo Code** Rules (.roo/instructions.md)
- **Gemini CLI** (GEMINI.md + .gemini/memories/)
- **JetBrains Junie** Guidelines (.junie/guidelines.md)
- **Kiro IDE** Custom Steering Documents
- **OpenAI Codex CLI** (hierarchical codex.md files)
- **Windsurf AI Code Editor** (.windsurf/rules/ + MCP + ignore files)

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

### .rulesync Directory Structure

The project uses a comprehensive `.rulesync` directory for internal rule management and tool specifications:

```
.rulesync/
├── overview.md                           # Project overview and architecture (root: true)
├── my-instructions.md                    # Custom project instructions
├── precautions.md                       # Development precautions and guidelines
└── specification-[tool]-[type].md       # Tool-specific specifications
    # Types: rules, mcp, ignore
    # Tools: augmentcode, claudecode, cline, codexcli, copilot, cursor,
    #        geminicli, junie, kiro, roo, windsurf (NEW)
```

**Comprehensive Specifications**: Each AI tool has detailed specifications covering:
- **Rules format**: File structure, frontmatter (now optional with defaults), hierarchy patterns
- **MCP configuration**: Server setup, transport types, environment handling
- **Ignore patterns**: Security-focused exclusions and file access control

**Recent Major Updates (v0.56.0)**:
- **Optional Frontmatter**: All frontmatter fields now have sensible defaults
- **Registry Pattern**: Unified generator architecture for easier tool addition
- **Enhanced Windsurf Support**: Complete integration with activation modes and output formats

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
│   │   │   ├── import.ts               # Import existing configurations
│   │   │   ├── watch.ts                # Real-time file watching
│   │   │   ├── status.ts               # Project status and health checks
│   │   │   ├── validate.ts             # Rule validation with detailed reporting
│   │   │   ├── gitignore.ts            # Smart .gitignore management
│   │   │   └── config.ts               # Configuration management
│   │   └── index.ts                   # CLI entry point (Commander.js)
│   ├── core/
│   │   ├── parser.ts                  # Parse .rulesync/*.md files
│   │   ├── generator.ts               # Orchestrate generation (registry-aware)
│   │   ├── importer.ts                # Import existing configurations
│   │   ├── validator.ts               # Comprehensive rule validation
│   │   ├── mcp-generator.ts           # MCP-specific generation with factory pattern
│   │   └── mcp-parser.ts              # MCP configuration parsing
│   ├── generators/                    # Organized by output type with shared patterns
│   │   ├── rules/                     # Standard rule generators
│   │   │   ├── generator-registry.ts  # ⭐ NEW: Registry pattern for rule generation
│   │   │   ├── shared-helpers.ts      # ⭐ NEW: Shared generation utilities
│   │   │   ├── augmentcode.ts         # AugmentCode Rules (current + legacy)
│   │   │   ├── claudecode.ts          # Claude Code Memory (complex hierarchy)
│   │   │   ├── cline.ts               # Cline Rules (.cline/instructions.md)
│   │   │   ├── codexcli.ts            # OpenAI Codex CLI (hierarchical codex.md)
│   │   │   ├── copilot.ts             # GitHub Copilot (.github/copilot-*.md)
│   │   │   ├── cursor.ts              # Cursor Rules (4 activation types)
│   │   │   ├── geminicli.ts           # Gemini CLI (GEMINI.md + memories)
│   │   │   ├── junie.ts               # JetBrains Junie (.junie/guidelines.md)
│   │   │   ├── kiro.ts                # Kiro IDE Custom Steering Documents
│   │   │   ├── roo.ts                 # Roo Code Rules (.roo/instructions.md)
│   │   │   └── windsurf.ts            # ⭐ NEW: Windsurf (.windsurf/rules/ + memories)
│   │   ├── mcp/                       # MCP configuration generators
│   │   │   ├── shared-factory.ts      # ⭐ NEW: Shared MCP configuration factory
│   │   │   └── [tool].ts              # Individual MCP generators (11 tools)
│   │   └── ignore/                    # Ignore file generators
│   │       ├── shared-factory.ts      # ⭐ NEW: Shared ignore file factory
│   │       ├── shared-helpers.ts      # ⭐ NEW: Common ignore pattern utilities
│   │       └── [tool].ts              # Security-focused ignore generators (6 tools)
│   ├── parsers/                       # Tool-specific parsers (comprehensive coverage)
│   │   ├── shared-helpers.ts          # ⭐ NEW: Shared parsing utilities
│   │   ├── augmentcode.ts             # Parse AugmentCode (.augmentcode + legacy)
│   │   ├── claudecode.ts              # Parse Claude Code (CLAUDE.md + memories)
│   │   ├── cline.ts                   # Parse Cline (.cline/instructions.md)
│   │   ├── codexcli.ts                # Parse Codex CLI (hierarchical discovery)
│   │   ├── copilot.ts                 # Parse GitHub Copilot (.github/copilot-*.md)
│   │   ├── cursor.ts                  # Parse Cursor (.cursorrules + .cursor/rules/*.mdc)
│   │   ├── geminicli.ts               # Parse Gemini CLI (GEMINI.md + memories)
│   │   ├── junie.ts                   # Parse Junie (.junie/guidelines.md)
│   │   ├── roo.ts                     # Parse Roo (.roo/instructions.md)
│   │   └── windsurf.ts                # ⭐ NEW: Parse Windsurf (.windsurf/rules/)
│   ├── types/                         # Enhanced TypeScript definitions
│   │   ├── config.ts                  # Configuration types
│   │   ├── rules.ts                   # Rule and frontmatter types (extended)
│   │   ├── mcp.ts                     # MCP-specific types
│   │   ├── mcp-config.ts              # ⭐ NEW: MCP configuration types
│   │   ├── claudecode.ts              # ⭐ NEW: Claude Code specific types
│   │   ├── tool-targets.ts            # Updated tool target definitions (12 tools)
│   │   └── config-options.ts          # Configuration option types
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
```

### Test Coverage Expectations

**Current Coverage by Module** (Target: 80%+):

- **cli/commands**: **Excellent** - All commands fully tested with edge cases
- **core**: **High** - Parser, generator, importer, validator extensively tested
- **generators/rules**: **High** - All 12 tools with 250-350 lines each
- **generators/mcp**: **High** - All transport types and configurations
- **generators/ignore**: **High** - Security patterns and factory functions
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

**Enhanced Tool Support** (12 total tools):
- **Comprehensive Coverage**: All major AI development tools supported
- **Hierarchical Systems**: Multi-level rule precedence for complex tools (Codex CLI, Claude Code)
- **Legacy Support**: AugmentCode legacy format maintained alongside current format
- **Security Focus**: Advanced ignore patterns with security-first approach

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
