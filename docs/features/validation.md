# Rule File Validation

## Overview

rulesync includes comprehensive validation functionality to ensure rule files are properly formatted and configured. The validation system helps catch common errors early and provides helpful guidance for fixing issues.

## Validation Command

### Basic Usage
```bash
# Validate all rule files in .rulesync/ directory
npx rulesync validate

# Validate with verbose output
npx rulesync validate --verbose

# Validate specific base directory
npx rulesync validate --base-dir ./packages/frontend
```

### Exit Codes
- **0**: All validation checks passed
- **1**: Validation errors found
- **2**: Critical errors (file system issues, etc.)

## Validation Rules

### Rule Level Validation

#### Single Root Rule Requirement
- **Rule**: Only one rule file can have `root: true`
- **Error**: "Multiple root rules found"
- **Fix**: Ensure only one file in `.rulesync/` has `root: true`

Example error:
```
❌ Multiple root rules found:
   - .rulesync/overview.md (root: true)
   - .rulesync/project-setup.md (root: true)
   
Fix: Only one rule file should have 'root: true'
```

#### Root Rule Requirements
- **Rule**: Root rules must have `root: true` and appropriate content
- **Error**: "Root rule missing required fields"
- **Fix**: Ensure root rule has proper frontmatter and content

### Frontmatter Validation

#### Required Fields (Pre-v0.56.0)
In older versions, all frontmatter fields were required:
- `root`: boolean (true/false)
- `targets`: array of target tools
- `description`: string description
- `globs`: array of file patterns

#### Optional Fields (v0.56.0+)
All frontmatter fields are now optional with sensible defaults:
- `root`: defaults to `false`
- `targets`: defaults to `["*"]` (all tools)
- `description`: defaults to generated from filename
- `globs`: defaults to `["**/*"]`

#### Field Type Validation
- **`root`**: Must be boolean (`true` or `false`)
- **`targets`**: Must be array of valid tool names
- **`description`**: Must be non-empty string
- **`globs`**: Must be array of valid glob patterns

Example validation errors:
```yaml
---
root: "true"           # ❌ Should be boolean: root: true
targets: "cursor"      # ❌ Should be array: targets: ["cursor"]
description: ""        # ❌ Should be non-empty string
globs: "**/*.ts"       # ❌ Should be array: globs: ["**/*.ts"]
---
```

### Tool Target Validation

#### Valid Tool Names
Supported tool names for `targets` field:
- `claudecode`
- `cursor`
- `copilot`
- `cline`
- `codexcli`
- `augmentcode`
- `roo`
- `geminicli`
- `junie`
- `kiro`
- `windsurf`
- `*` (all tools)

#### Invalid Tool Names
```yaml
---
targets: ["claude", "github-copilot", "unknown-tool"]  # ❌ Invalid tool names
---
```

Error message:
```
❌ Invalid tool names in targets:
   - "claude" (did you mean "claudecode"?)
   - "github-copilot" (did you mean "copilot"?)
   - "unknown-tool" (not a recognized tool)
```

### Glob Pattern Validation

#### Valid Patterns
```yaml
---
globs: [
  "**/*.ts",           # ✅ Valid: all TypeScript files
  "src/**/*.jsx",      # ✅ Valid: JSX files in src/
  "!node_modules/**",  # ✅ Valid: negation pattern
  "**/test/**"         # ✅ Valid: test directories
]
---
```

#### Invalid Patterns
```yaml
---
globs: [
  "**.ts",             # ❌ Invalid: malformed glob
  "[unclosed",         # ❌ Invalid: unclosed bracket
  "**/../**"           # ❌ Invalid: parent directory traversal
]
---
```

### File System Validation

#### File Accessibility
- **Rule**: All rule files must be readable
- **Error**: "Cannot read rule file"
- **Fix**: Check file permissions and existence

#### Directory Structure
- **Rule**: `.rulesync/` directory must exist and be accessible
- **Error**: "Rules directory not found"
- **Fix**: Ensure `.rulesync/` directory exists

#### File Format
- **Rule**: Rule files must be valid Markdown with optional YAML frontmatter
- **Error**: "Invalid file format"
- **Fix**: Ensure files are valid Markdown with proper YAML frontmatter syntax

## Validation Output

### Success Output
```bash
$ npx rulesync validate
✅ Validation completed successfully

Summary:
- 5 rule files validated
- 1 root rule found
- 4 detail rules found
- 0 errors found
```

### Error Output
```bash
$ npx rulesync validate
❌ Validation failed with 3 errors

Errors:
1. Multiple root rules found:
   - .rulesync/overview.md
   - .rulesync/setup.md

2. Invalid tool target in .rulesync/typescript-rules.md:
   - "claude" (did you mean "claudecode"?)

3. Invalid glob pattern in .rulesync/test-rules.md:
   - "**.test.ts" (should be "**/*.test.ts")

Fix these errors and run validation again.
```

### Verbose Output
```bash
$ npx rulesync validate --verbose
🔍 Starting validation...

📁 Scanning .rulesync/ directory
   Found 5 rule files

📄 Validating .rulesync/overview.md
   ✅ Frontmatter: valid YAML
   ✅ Root rule: properly configured
   ✅ Targets: ["*"] - valid
   ✅ Globs: ["**/*"] - valid

📄 Validating .rulesync/typescript-rules.md
   ✅ Frontmatter: valid YAML
   ✅ Non-root rule: properly configured
   ❌ Targets: ["claude"] - invalid tool name
   ✅ Globs: ["**/*.ts", "**/*.tsx"] - valid

📄 Validating .rulesync/test-rules.md
   ✅ Frontmatter: valid YAML
   ✅ Non-root rule: properly configured
   ✅ Targets: ["*"] - valid
   ❌ Globs: ["**.test.ts"] - invalid pattern

Summary:
❌ Validation failed with 2 errors
```

## Advanced Validation

### Custom Validation Rules

#### Tool-Specific Validation
Some validations are tool-specific:

**Cursor Rules**:
```yaml
---
cursorRuleType: "invalid"  # ❌ Must be: always, manual, specificFiles, intelligently
---
```

**Windsurf Rules**:
```yaml
---
windsurfActivationMode: "invalid"  # ❌ Must be: always, manual, model-decision, glob
windsurfOutputFormat: "invalid"    # ❌ Must be: single-file, directory
---
```

#### Content Validation
- **Empty Files**: Warning for empty rule files
- **No Frontmatter**: Warning for files without frontmatter (uses defaults)
- **Long Content**: Warning for extremely long rule files (performance impact)

### Configuration Validation

#### Rule Configuration
```yaml
---
root: true
targets: ["cursor"]
globs: ["**/*.ts"]
cursorRuleType: "specificFiles"  # ✅ Valid for specificFiles with globs
---
```

```yaml
---
root: false
targets: ["cursor"]
description: "TypeScript guidelines"
globs: []  # Empty globs
cursorRuleType: "intelligently"  # ✅ Valid for intelligently with description
---
```

### Command Validation

#### Command File Structure
```bash
.rulesync/commands/
├── valid-command.md        # ✅ Valid command file
├── invalid/                # ❌ Commands must be .md files
└── nested/
    └── namespaced.md       # ✅ Valid namespaced command
```

#### Command Frontmatter
```yaml
---
targets: ["claudecode", "geminicli"]  # ✅ Valid command targets
description: "Command description"     # ✅ Valid description
---
```

```yaml
---
targets: ["invalid-tool"]             # ❌ Invalid command target
name: "custom-name"                   # ❌ Name is derived from filename
---
```

## Integration with Development Workflow

### Pre-commit Validation
Add validation to your pre-commit hooks:

```bash
#!/bin/sh
# .git/hooks/pre-commit

echo "Validating rulesync rules..."
if ! npx rulesync validate; then
    echo "❌ Rule validation failed. Fix errors before committing."
    exit 1
fi

echo "✅ Rule validation passed."
```

### CI/CD Integration
Add validation to your CI pipeline:

```yaml
# .github/workflows/validate-rules.yml
name: Validate Rules

on:
  pull_request:
    paths:
      - '.rulesync/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g rulesync
      - run: npx rulesync validate
```

### Editor Integration
Many editors can validate YAML frontmatter:

**VS Code** (with YAML extension):
```json
{
  "yaml.schemas": {
    "https://rulesync.dev/schemas/rule.json": ".rulesync/*.md"
  }
}
```

## Troubleshooting Validation

### Common Validation Errors

#### Multiple Root Rules
```
❌ Multiple root rules found
```
**Solution**: Ensure only one rule file has `root: true`

#### Invalid Tool Names
```
❌ Invalid tool target: "claude"
```
**Solution**: Use correct tool name `"claudecode"`

#### Invalid Glob Patterns
```
❌ Invalid glob pattern: "**.ts"
```
**Solution**: Use valid glob syntax: `"**/*.ts"`

#### YAML Syntax Errors
```
❌ Invalid YAML frontmatter
```
**Solution**: Check YAML syntax, indentation, and quotes

### Debugging Validation Issues

#### Verbose Mode
Use `--verbose` flag to see detailed validation information:
```bash
npx rulesync validate --verbose
```

#### Individual File Testing
Test individual files by checking their frontmatter:
```yaml
---
root: true        # Check boolean value
targets: ["*"]    # Check array syntax
description: ""   # Check string value
globs: ["**/*"]   # Check array of strings
---
```

#### YAML Validation Tools
Use online YAML validators to check frontmatter syntax:
- https://yamllint.com/
- https://yamlchecker.com/

### Performance Considerations

#### Large Projects
For projects with many rule files:
- Validation time increases with file count
- Use specific `--base-dir` to validate subsets
- Consider splitting large rule files

#### File System Issues
- Ensure adequate file system permissions
- Check for symlink issues in rules directory
- Verify file encoding (UTF-8 recommended)

## Best Practices

### Regular Validation
1. **Before Commits**: Validate rules before committing changes
2. **After Imports**: Always validate after importing from other tools
3. **During Development**: Run validation when creating new rules
4. **CI Integration**: Include validation in continuous integration

### Error Prevention
1. **Use Templates**: Start with valid rule templates
2. **Incremental Development**: Add rules gradually and validate frequently
3. **Tool Support**: Use editors with YAML validation
4. **Team Standards**: Establish team guidelines for rule creation

### Validation Workflow
1. **Create/Edit Rules**: Make changes to rule files
2. **Quick Validate**: Run `npx rulesync validate` locally
3. **Fix Issues**: Address any validation errors
4. **Commit Changes**: Commit only after successful validation
5. **CI Validation**: Let CI confirm validation in clean environment

## See Also

- [Configuration](../configuration.md) - Understanding rule structure and frontmatter
- [Best Practices](../guides/best-practices.md) - Rule organization and management
- [Troubleshooting](../guides/troubleshooting.md) - Common issues and solutions