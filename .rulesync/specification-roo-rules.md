---
root: false
targets: ["*"]
description: "Roo Code rules and memories configuration specification"
globs: []
---

# Roo Code Rules and Memories Configuration Specification

## Overview
Roo Code uses a hierarchical system of instruction and rule files to provide persistent context and project-specific guidance to its AI assistant. This system includes workspace rules, mode-specific rules, global configurations, and an optional memory-bank system for long-term project context.

## File Placement and Hierarchy

### 1. Workspace Rules (Project-Level)

#### Preferred Directory Layout
- **Location**: `.roo/rules/` directory in workspace root
- **Scope**: Workspace-wide rules applied to all modes
- **File Processing**: Files are read recursively and concatenated in **alphabetical order (case-insensitive)**
- **System Files**: `.DS_Store` and other system files are automatically ignored

#### Mode-Specific Rules
- **Location**: `.roo/rules-{mode-slug}/` directories
- **Purpose**: Rules that apply only to specific modes (e.g., `.roo/rules-code/` for Code mode)
- **Examples**:
  - `.roo/rules-code/` - Rules for Code mode
  - `.roo/rules-architect/` - Rules for Architect mode
  - `.roo/rules-ask/` - Rules for Ask mode

#### Fallback Single-File Layout
For projects preferring single-file configurations:
- **Workspace-wide**: `.roorules` in workspace root
- **Mode-specific**: `.roorules-{mode-slug}` in workspace root

#### Legacy Compatibility
- **`.clinerules`**: Legacy compatibility files (still accepted but deprecated)
- **`.clinerules-{mode-slug}`**: Mode-specific legacy files
- **Recommendation**: Use `.roorules` format for new projects

### 2. Global Rules (User-Level)

#### Location by Platform
- **Linux/macOS**: `~/.roo/rules/` and `~/.roo/rules-{mode-slug}/`
- **Windows**: `%USERPROFILE%\.roo\rules\` and `%USERPROFILE%\.roo\rules-{mode-slug}\`

#### Precedence Rules
- Project rules override global rules of the same scope
- Directory-based rules always override file-based fallbacks

## Rule Loading and Precedence

### System Prompt Construction Order
The final prompt section is built in this exact order:

1. **Global UI Instructions** (from Custom Instructions UI)
2. **Mode-specific UI Instructions** (from Custom Instructions UI)
3. **Global Rule Files** (mode-specific before general)
4. **Workspace Rule Files** (mode-specific before general)

### File Discovery Process
1. Check for directory-based rules (`.roo/rules/` and `.roo/rules-{mode}/`)
2. Fall back to single-file rules (`.roorules` and `.roorules-{mode}`)
3. Load global rules from user directory
4. Apply precedence rules (project overrides global, directory overrides file)

## File Format and Structure

### Basic Format
- **File Type**: Plain Markdown (`.md`)
- **Encoding**: UTF-8
- **Structure**: No special frontmatter required - entire file content becomes part of AI context

### Content Organization
```markdown
# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- Styling: Tailwind CSS

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types
3. Write meaningful variable names
4. Always include error handling

## Architecture Patterns
- Follow clean architecture principles
- Use dependency injection for services
- Separate concerns with clear boundaries

## Security Guidelines
- Never commit secrets or API keys
- Validate all user inputs
- Use environment variables for configuration
```

### Subdirectory Support

#### Unlimited Recursive Loading
- **Full Recursion**: Supports unlimited nesting depth within `.roo/rules/` directories
- **File Discovery**: Uses Node.js `fs.readdir(dir, {withFileTypes: true, recursive: true})`
- **No Depth Limit**: Only limited by OS path length (~260 chars on older Windows) or system resources
- **File Types**: Loads all files (binary files may cause issues - avoid swap files)

#### File Processing Order
- **Sorting**: Files sorted by full relative path in lexicographical order (case-insensitive)
- **Directory Independence**: Subdirectory location doesn't affect precedence
- **Naming Control**: Use numeric prefixes (00-, 10-, 20-) to guarantee load order
- **Context Limits**: When combined rules exceed LLM context window, oldest (alphabetically-first) rules are truncated

#### Directory Organization Examples
```
.roo/
├── rules/
│   ├── 00-global-standards.md    # Loaded first (numeric prefix)
│   ├── security/
│   │   ├── 10-auth-policy.md     # Loaded by numeric prefix
│   │   └── db/
│   │       └── encryption.md     # Deep nesting supported
│   ├── api/
│   │   ├── contracts.md
│   │   └── validation.md
│   └── frontend/
│       ├── components.md
│       └── styling.md
└── rules-typescript/             # Mode-specific rules
    ├── 00-type-safety.md
    └── patterns/
        └── react-hooks.md
```

## Custom Mode Configuration

### Configuration Files
- **Global**: `~/.roo/custom_modes.yaml` (preferred) or `custom_modes.json`
- **Project**: `{workspace}/.roomodes` (YAML or JSON, auto-detected)

### YAML Configuration Format
```yaml
customModes:
  - slug: docs-writer            # Unique identifier (used for rules mapping)
    name: "Documentation Writer" # Display name in mode switcher
    description: "Writes & edits tech docs"
    roleDefinition: |
      You are a technical writer focused on creating clear,
      comprehensive documentation for software projects.
    whenToUse: "Use for documentation tasks"
    customInstructions: |
      Focus on clarity and completeness.
      Always include examples and code snippets.
    groups:
      - read
      - ["edit", {fileRegex: "\\.(md|mdx)$", description: "Markdown only"}]
      - browser
```

### Configuration Rules
- **slug**: Must match `/^[a-zA-Z0-9-]+$/` pattern
- **slug Mapping**: Maps to `.roo/rules-{slug}/` directory for mode-specific rules
- **groups**: Accepts simple strings ("read") or tuples `["edit", {fileRegex: "..."}]`
- **Format**: YAML is default; JSON is still supported
- **Override Behavior**: Project `.roomodes` fully overrides global mode of same slug

### Import/Export Functionality
- **Export**: "Export Mode" button packages mode plus its `.roo/rules-{slug}/` contents into single YAML file
- **Import**: Automatically rewrites paths if slug is changed during import
- **Team Sharing**: Enables easy sharing of complete mode configurations

## Memory-Bank System (Community Standard)

### Overview
The memory-bank system is a community-developed convention for providing long-term project context across chat sessions. While not part of the core Roo Code extension, it's widely adopted by popular rule sets.

### Directory Structure
```
memory-bank/
├── activeContext.md   # Current goals, blockers, immediate focus
├── productContext.md  # Project purpose, users, and business context
├── progress.md        # Completed work and next steps
├── decisionLog.md     # Architecture decisions and trade-offs
└── systemPatterns.md  # Recurring patterns and conventions (optional)
```

### File Purposes

#### activeContext.md
- Current sprint goals and objectives
- Active blockers and challenges
- Immediate development focus areas
- Context for current session

#### productContext.md
- Project purpose and vision
- Target users and use cases
- Business requirements and constraints
- Product roadmap and priorities

#### progress.md
- Recently completed features and fixes
- Current work in progress
- Planned next steps and priorities
- Milestone tracking

#### decisionLog.md
- Architecture decisions and rationale
- Technology choices and trade-offs
- Design patterns and conventions
- Performance and security considerations

#### systemPatterns.md
- Recurring code patterns and idioms
- Common solutions and utilities
- Team conventions and standards
- Reusable components and modules

### Workflow Integration

#### Automatic Scaffolding
1. On first message in Architect or Code mode
2. Roo scans for `memory-bank/` directory
3. If missing, prompts to create and scaffolds the Markdown files
4. Initializes files with appropriate templates

#### Update Mechanisms
- **Automatic**: Significant events trigger writes to appropriate files
- **Manual**: Type "update memory bank" (UMB) to force synchronization
- **Event-Driven**: Code commits, design decisions, progress updates

#### Benefits
- **Persistent Knowledge**: Maintains project context across VS Code restarts
- **Token Efficiency**: Reduces context-window usage by storing history on disk
- **Autonomous Workflows**: Enables mode-switching workflows from popular templates
- **Team Consistency**: Shared understanding of project state and decisions

## Best Practices

### Rule Organization
1. **Separation of Concerns**: Use different files for different rule categories
2. **Mode-Specific Rules**: Leverage mode-specific directories for targeted guidance
3. **Hierarchical Structure**: Organize rules from general to specific
4. **Clear Naming**: Use descriptive filenames for easy identification
5. **Numeric Prefixes**: Use `00-`, `10-`, `20-` to control load order across directories

### Content Guidelines
1. **Be Specific**: Include concrete examples and patterns
2. **Use Examples**: Show preferred code structures and implementations
3. **Security First**: Emphasize security practices and constraints
4. **Keep Current**: Regular updates as project evolves
5. **Focused Files**: Keep individual rule files small and focused

### Team Collaboration
1. **Version Control**: Commit `.roo/` directory for team sharing
2. **Documentation**: Document rule purposes and conventions
3. **Regular Review**: Update rules based on team feedback and project changes
4. **Standardization**: Establish consistent rule formats across projects

### Memory-Bank Maintenance
1. **Regular Updates**: Keep memory files current with project state
2. **Focused Content**: Maintain relevant, actionable information
3. **Archive Old Content**: Move outdated information to separate archives
4. **Template Consistency**: Use established templates for new projects

## Integration with Other Tools

### Version Control
- Commit `.roo/rules/` and `.roomodes` for team consistency
- Include memory-bank files in version control for shared context
- Use `.gitignore` for personal/temporary rule files if needed

### CI/CD Integration
- Reference coding standards in automated checks
- Validate rule file syntax in CI pipeline
- Ensure rule consistency across environments

### IDE Integration
- Rules automatically loaded when workspace opens
- Changes reflected immediately without restart
- Integration with VS Code settings and preferences

## Advanced Configuration

### File Pattern Matching
Rules can include glob patterns for specific file targeting:
```markdown
# TypeScript-specific rules
Apply these rules to all TypeScript files:
- Use strict type checking
- Prefer interfaces over types for object shapes
- Include proper JSDoc comments
```

### Conditional Rules
```markdown
# Environment-specific guidelines
## Development
- Enable verbose logging
- Use development database
- Allow experimental features

## Production
- Minimal logging
- Production database only
- Disable debug features
```

### Multi-Project Configurations
For monorepos or related projects:
```yaml
# Global configuration for related projects
customModes:
  - slug: frontend-dev
    name: "Frontend Developer"
    customInstructions: |
      Focus on React components and TypeScript.
      Follow company UI/UX guidelines.
    groups:
      - read
      - ["edit", {fileRegex: "src/.*\\.(ts|tsx|css)$"}]
  
  - slug: backend-dev
    name: "Backend Developer"
    customInstructions: |
      Focus on API development and database design.
      Follow REST API conventions.
    groups:
      - read
      - ["edit", {fileRegex: "server/.*\\.(ts|js|sql)$"}]
```

## Troubleshooting

### Common Issues
1. **Rules Not Loading**: Check file locations and naming conventions
2. **Mode-Specific Rules Ignored**: Verify slug matching between mode and directory
3. **Precedence Problems**: Review hierarchy and override behavior
4. **Memory-Bank Not Created**: Ensure compatible templates are in use

### Debugging Steps
1. **Check File Paths**: Verify correct directory structure and file placement
2. **Validate YAML**: Ensure custom mode configurations are valid YAML/JSON
3. **Test Rule Loading**: Use simple test rules to verify loading behavior
4. **Review Logs**: Check VS Code output for Roo Code error messages

### Performance Optimization
1. **File Size**: Keep rule files reasonably sized to avoid context bloat
2. **Organization**: Use directory structure to load only relevant rules
3. **Caching**: Rules are cached for performance - restart if changes don't appear
4. **Memory Management**: Regular cleanup of memory-bank files for relevance
5. **Clean Environment**: Avoid editor swap files (`.swp`, temporary files) in rules directories

This specification provides comprehensive guidance for configuring Roo Code's rule and memory systems, enabling effective AI-assisted development workflows with persistent project context and coding standards.