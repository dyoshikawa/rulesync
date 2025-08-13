# Import Existing Configurations

## Overview

rulesync provides comprehensive import functionality to convert existing AI tool configurations into the unified rulesync format. This enables teams to migrate from tool-specific configurations while preserving existing rules and customizations.

## Supported Import Sources

| Tool | Import Sources | Command |
|------|---------------|---------|
| **Claude Code** | `CLAUDE.md`, `.claude/memories/*.md`, `.claude/commands/*.md` | `--claudecode` |
| **Cursor** | `.cursorrules`, `.cursor/rules/*.mdc`, `.cursorignore`, `.cursor/mcp.json` | `--cursor` |
| **GitHub Copilot** | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `--copilot` |
| **Cline** | `.cline/instructions.md`, `.clinerules/*.md` | `--cline` |
| **AugmentCode** | `.augment/rules/*.md`, `.augment-guidelines` (legacy) | `--augmentcode`, `--augmentcode-legacy` |
| **Roo Code** | `.roo/instructions.md`, `.roo/rules/*.md` | `--roo` |
| **Gemini CLI** | `GEMINI.md`, `.gemini/memories/*.md`, `.gemini/commands/*.md` | `--geminicli` |
| **JetBrains Junie** | `.junie/guidelines.md` | `--junie` |
| **Windsurf** | `.windsurf/rules/*.md`, `.windsurf-rules`, `.windsurf/mcp.json` | `--windsurf` |

## Import Commands

### Basic Import
```bash
# Import from specific tools (one at a time)
npx rulesync import --claudecode
npx rulesync import --cursor
npx rulesync import --copilot
npx rulesync import --cline
```

### Enhanced Import Options
```bash
# Verbose output during import
npx rulesync import --claudecode --verbose

# Import with specific base directory
npx rulesync import --cursor --base-dir ./packages/frontend

# Import legacy formats
npx rulesync import --augmentcode-legacy
```

### Multiple Tool Import Workflow
```bash
# Step-by-step import from multiple tools
npx rulesync import --claudecode
npx rulesync import --cursor
npx rulesync import --copilot

# Review merged rules in .rulesync/ directory
# Then generate unified configurations
npx rulesync generate
```

## Import Features (v0.58.0+)

### Enhanced Import Capabilities
- **Overwrite Protection**: Safely imports without overwriting existing `.rulesync/` files
- **Commands Directory Support**: Automatically detects and imports custom slash commands
- **Improved Organization**: Creates better organized rule files with descriptive names
- **MCP Configuration Import**: Imports Model Context Protocol configurations where available

### File Organization
- **Tool-Specific Prefixes**: Uses prefixes to avoid filename conflicts (e.g., `claudecode-overview.md`, `cursor-custom-rules.md`)
- **Unique Filenames**: Generates unique filenames if conflicts occur
- **Complex Format Support**: Handles formats like Cursor's MDC files with YAML frontmatter
- **Multi-File Import**: Supports importing from directories with multiple files

## Tool-Specific Import Details

### Claude Code Import
**Sources**:
- `CLAUDE.md` → Root rule with project overview
- `.claude/memories/*.md` → Non-root rules by category
- `.claude/commands/*.md` → Custom slash commands

**Import Process**:
```bash
npx rulesync import --claudecode
```

**Generated Files**:
- `.rulesync/claudecode-overview.md` (from CLAUDE.md)
- `.rulesync/claudecode-[memory-name].md` (from memory files)
- `.rulesync/commands/[command-name].md` (from command files)

### Cursor Import
**Sources**:
- `.cursorrules` (legacy single-file format)
- `.cursor/rules/*.mdc` (modern MDC format with YAML frontmatter)
- `.cursorignore` → `.rulesyncignore` patterns
- `.cursor/mcp.json` → `.rulesync/.mcp.json`

**Rule Type Detection**:
Cursor's four rule types are automatically identified and converted:

1. **`alwaysApply: true`** → `cursorRuleType: "always"`
   - Imported as non-root rule with `globs: ["**/*"]`

2. **Empty description + empty globs + `alwaysApply: false`** → `cursorRuleType: "manual"`
   - Imported with empty globs patterns

3. **Globs specified** → `cursorRuleType: "specificFiles"`
   - Globs patterns preserved, description set to empty

4. **Description specified + empty globs** → `cursorRuleType: "intelligently"`
   - Description preserved, empty globs patterns

**Import Process**:
```bash
npx rulesync import --cursor
```

**Edge Cases**:
- **Non-empty description + non-empty globs**: Processed as `specificFiles`
- **No matching conditions**: Processed as `manual`

### GitHub Copilot Import
**Sources**:
- `.github/copilot-instructions.md` → Main instructions
- `.github/instructions/*.instructions.md` → Individual instruction files

**Import Process**:
```bash
npx rulesync import --copilot
```

**Generated Files**:
- `.rulesync/copilot-main-instructions.md`
- `.rulesync/copilot-[instruction-name].md`

### AugmentCode Import
**Modern Format**:
```bash
npx rulesync import --augmentcode
```

**Sources**: `.augment/rules/*.md` files with YAML frontmatter

**Legacy Format**:
```bash
npx rulesync import --augmentcode-legacy
```

**Sources**: `.augment-guidelines` single file

**Type Conversion**:
- `type: always` → Root rule or always-applied non-root
- `type: auto` → Non-root rule with description
- `type: manual` → Non-root rule without description

### Gemini CLI Import
**Sources**:
- `GEMINI.md` → Root rule with project context
- `.gemini/memories/*.md` → Memory files
- `.gemini/commands/*.md` → Custom slash commands

**Import Process**:
```bash
npx rulesync import --geminicli
```

**Generated Files**:
- `.rulesync/geminicli-overview.md`
- `.rulesync/geminicli-[memory-name].md`
- `.rulesync/commands/[command-name].md`

## Import Workflow

### Pre-Import Preparation
1. **Backup Existing**: Create backup of existing configurations
2. **Clean State**: Ensure `.rulesync/` directory is in desired state
3. **Tool Selection**: Identify which tools have configurations to import

### Import Process
1. **Single Tool Import**: Import one tool at a time to review results
   ```bash
   npx rulesync import --claudecode
   # Review generated files in .rulesync/
   ```

2. **Review Generated Files**: Check `.rulesync/` directory for imported content
   ```bash
   ls -la .rulesync/
   cat .rulesync/claudecode-overview.md
   ```

3. **Multiple Tool Import**: Import additional tools if needed
   ```bash
   npx rulesync import --cursor
   npx rulesync import --copilot
   ```

4. **Consolidation**: Review and potentially merge similar rules
   ```bash
   # Edit files in .rulesync/ to consolidate duplicate content
   ```

5. **Generation**: Generate unified configurations
   ```bash
   npx rulesync generate
   ```

### Post-Import Tasks
1. **Validation**: Use validation to check for issues
   ```bash
   npx rulesync validate
   ```

2. **Testing**: Test generated configurations with target tools
3. **Refinement**: Adjust rules based on testing results
4. **Team Review**: Have team members review imported and generated rules

## Advanced Import Scenarios

### Monorepo Import
```bash
# Import configurations for different packages
npx rulesync import --claudecode --base-dir ./packages/frontend
npx rulesync import --cursor --base-dir ./packages/backend
npx rulesync import --copilot --base-dir ./packages/shared
```

### Selective Import
```bash
# Import only specific aspects
npx rulesync import --claudecode  # Rules and commands
# Manually copy MCP configs if needed
cp .mcp.json .rulesync/.mcp.json
```

### Legacy Migration
```bash
# Import from legacy formats
npx rulesync import --augmentcode-legacy
# Review and modernize content
# Generate modern configurations
npx rulesync generate --augmentcode
```

## Import Conflicts and Resolution

### Filename Conflicts
When importing from multiple tools, rulesync handles conflicts by:
1. **Tool Prefixes**: Adding tool-specific prefixes (e.g., `claudecode-`, `cursor-`)
2. **Unique Naming**: Generating unique filenames for duplicates
3. **Incremental Numbering**: Adding numbers for additional conflicts

### Content Duplication
1. **Manual Review**: Review imported files for duplicate content
2. **Content Merging**: Combine similar rules into unified files
3. **Rule Consolidation**: Remove redundant or contradictory rules
4. **Frontmatter Updates**: Adjust metadata to reflect merged content

### Command Conflicts
1. **Command Namespacing**: Use subdirectories to avoid command name conflicts
2. **Tool Targeting**: Use `targets` field to specify which tools should use each command
3. **Command Merging**: Combine similar commands with appropriate targeting

## Best Practices

### Import Planning
1. **Inventory Existing**: Document current configurations before import
2. **Priority Order**: Import most important/comprehensive tool first
3. **Incremental Approach**: Import one tool at a time for better control
4. **Backup Strategy**: Maintain backups of original configurations

### Content Review
1. **Rule Quality**: Review imported rules for relevance and accuracy
2. **Duplication Check**: Look for and eliminate duplicate content
3. **Metadata Validation**: Ensure frontmatter fields are appropriate
4. **Content Updates**: Update outdated or incorrect information

### Team Coordination
1. **Communication**: Inform team about import plans and timeline
2. **Review Process**: Include team members in reviewing imported content
3. **Migration Timeline**: Plan gradual migration to avoid disruption
4. **Training**: Educate team on new unified rule system

## Troubleshooting

### Common Import Issues
1. **File Not Found**: Check that source files exist in expected locations
2. **Format Errors**: Verify source files have valid YAML frontmatter or expected format
3. **Permission Errors**: Ensure read access to source files and write access to destination
4. **Encoding Issues**: Check file encoding (UTF-8 recommended)

### Import Validation
1. **Check Generated Files**: Verify files were created in `.rulesync/` directory
2. **Content Verification**: Review imported content for completeness and accuracy
3. **Metadata Check**: Ensure frontmatter was properly parsed and converted
4. **Command Import**: Verify custom commands were imported to `.rulesync/commands/`

### Debug Options
```bash
# Enable verbose output for detailed import information
npx rulesync import --claudecode --verbose

# Check import results
npx rulesync status

# Validate imported rules
npx rulesync validate
```

## Migration Strategies

### Gradual Migration
1. **Phase 1**: Import and test with one AI tool
2. **Phase 2**: Add additional tools incrementally
3. **Phase 3**: Refine and optimize unified rules
4. **Phase 4**: Full team adoption

### Tool-by-Tool Migration
1. **Assessment**: Evaluate each tool's configuration complexity
2. **Prioritization**: Start with most critical or comprehensive tool
3. **Import & Test**: Import, generate, and test each tool individually
4. **Integration**: Combine and optimize across tools

### Content Consolidation
1. **Audit**: Review all imported content for overlap and gaps
2. **Merge**: Combine similar rules while preserving tool-specific features
3. **Optimize**: Refactor for clarity and maintainability
4. **Validate**: Ensure consolidated rules work across target tools

## See Also

- [Configuration](../configuration.md) - Understanding rule structure and frontmatter
- [Validation](./validation.md) - Validating imported configurations
- [Tool Integrations](../tools/) - Tool-specific import details