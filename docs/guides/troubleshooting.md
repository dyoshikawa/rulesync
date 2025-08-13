# Troubleshooting Guide

## Overview

This comprehensive troubleshooting guide helps resolve common issues encountered when using rulesync. Issues are organized by category with step-by-step resolution procedures.

## Quick Diagnostic Commands

### System Health Check
```bash
# Check rulesync installation
rulesync --version

# Validate rule files
npx rulesync validate --verbose

# Check project status
npx rulesync status

# Test configuration loading
npx rulesync config

# Generate with dry-run
npx rulesync generate --verbose --dry-run
```

### Debug Environment
```bash
# Enable debug output
export DEBUG=rulesync:*

# Check Node.js version
node --version  # Should be 20+

# Verify package installation
npm list -g rulesync
```

## Installation Issues

### Problem: `rulesync: command not found`

**Symptoms**:
```bash
$ rulesync --version
bash: rulesync: command not found
```

**Solutions**:

1. **Global Installation**:
   ```bash
   # Install globally with npm
   npm install -g rulesync
   
   # Or with pnpm (faster)
   pnpm add -g rulesync
   
   # Or with yarn
   yarn global add rulesync
   ```

2. **Path Issues**:
   ```bash
   # Check npm global path
   npm config get prefix
   
   # Add to PATH if needed (add to ~/.bashrc or ~/.zshrc)
   export PATH="$(npm config get prefix)/bin:$PATH"
   ```

3. **Use npx as Alternative**:
   ```bash
   # Use npx without global installation
   npx rulesync --version
   ```

### Problem: Permission Errors During Installation

**Symptoms**:
```bash
npm WARN checkPermissions Missing write access to /usr/local/lib/node_modules
```

**Solutions**:

1. **Use Node Version Manager**:
   ```bash
   # Install nvm
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   
   # Install and use Node.js 20
   nvm install 20
   nvm use 20
   
   # Now install rulesync
   npm install -g rulesync
   ```

2. **Fix npm Permissions**:
   ```bash
   # Create npm global directory
   mkdir ~/.npm-global
   
   # Configure npm
   npm config set prefix '~/.npm-global'
   
   # Add to PATH
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.profile
   source ~/.profile
   ```

3. **Use sudo (Less Recommended)**:
   ```bash
   sudo npm install -g rulesync
   ```

### Problem: Node.js Version Compatibility

**Symptoms**:
```bash
Error: rulesync requires Node.js 20.0.0 or higher
```

**Solutions**:

1. **Check Current Version**:
   ```bash
   node --version
   ```

2. **Update Node.js**:
   ```bash
   # Using nvm (recommended)
   nvm install 20
   nvm alias default 20
   
   # Or download from nodejs.org
   # Or use system package manager
   brew install node  # macOS
   apt update && apt install nodejs npm  # Ubuntu
   ```

## Rule File Issues

### Problem: YAML Frontmatter Syntax Errors

**Symptoms**:
```bash
❌ Invalid YAML frontmatter in .rulesync/example.md
Error: bad indentation of a mapping entry
```

**Common YAML Mistakes**:

1. **Incorrect Indentation**:
   ```yaml
   # ❌ Incorrect
   ---
   root: true
   targets:
   - "cursor"
   - "claudecode"
   ---
   
   # ✅ Correct
   ---
   root: true
   targets:
     - "cursor"
     - "claudecode"
   ---
   ```

2. **Missing Quotes for Special Characters**:
   ```yaml
   # ❌ Incorrect
   description: My project's rules
   
   # ✅ Correct
   description: "My project's rules"
   ```

3. **Incorrect Boolean Values**:
   ```yaml
   # ❌ Incorrect
   root: "true"
   
   # ✅ Correct
   root: true
   ```

**Solutions**:

1. **Use Online YAML Validator**:
   - https://yamllint.com/
   - https://yamlchecker.com/

2. **Fix Common Issues**:
   ```bash
   # Find files with potential YAML issues
   grep -r "^\s*-\s*\"" .rulesync/  # Incorrect list indentation
   grep -r ": \"true\"" .rulesync/  # String instead of boolean
   ```

3. **Use Template**:
   ```yaml
   ---
   root: false
   targets: ["*"]
   description: "Brief description of the rule"
   globs: ["**/*"]
   ---
   
   # Your Markdown content here
   ```

### Problem: Multiple Root Rules

**Symptoms**:
```bash
❌ Multiple root rules found:
   - .rulesync/overview.md (root: true)
   - .rulesync/project-setup.md (root: true)
```

**Solutions**:

1. **Choose Single Root**:
   ```bash
   # Identify root rules
   grep -l "root: true" .rulesync/*.md
   
   # Keep one as root, change others to false
   # Edit .rulesync/project-setup.md
   ```

2. **Consolidate Content**:
   ```markdown
   # Merge multiple root rules into one comprehensive overview
   # Move specific content to detail rules
   ```

3. **Validate Fix**:
   ```bash
   npx rulesync validate
   ```

### Problem: Invalid Tool Names in Targets

**Symptoms**:
```bash
❌ Invalid tool names in targets:
   - "claude" (did you mean "claudecode"?)
   - "github-copilot" (did you mean "copilot"?)
```

**Common Mistakes and Corrections**:
```yaml
# ❌ Common incorrect names
targets: ["claude", "github-copilot", "cursor-ide", "cline-ai"]

# ✅ Correct tool names
targets: ["claudecode", "copilot", "cursor", "cline"]
```

**Valid Tool Names**:
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

### Problem: Invalid Glob Patterns

**Symptoms**:
```bash
❌ Invalid glob pattern: "**.ts"
❌ Invalid glob pattern: "[unclosed"
```

**Common Pattern Mistakes**:
```yaml
# ❌ Incorrect patterns
globs: [
  "**.ts",           # Missing slash
  "[unclosed",       # Unclosed bracket
  "**/../**"         # Parent directory traversal
]

# ✅ Correct patterns
globs: [
  "**/*.ts",         # All TypeScript files
  "src/**/*.tsx",    # React files in src
  "!**/*.test.*"     # Exclude test files
]
```

**Solutions**:

1. **Test Patterns Locally**:
   ```bash
   # Test glob patterns with ls
   ls **/*.ts
   ls src/**/*.tsx
   ```

2. **Use Common Patterns**:
   ```yaml
   # Language-specific
   globs: ["**/*.ts", "**/*.tsx"]          # TypeScript
   globs: ["**/*.js", "**/*.jsx"]          # JavaScript
   globs: ["**/*.py"]                      # Python
   globs: ["**/*.go"]                      # Go
   
   # Directory-specific
   globs: ["src/**/*"]                     # Source directory
   globs: ["components/**/*"]              # Components
   globs: ["!node_modules/**"]             # Exclude node_modules
   ```

## Generation Issues

### Problem: Generated Files Not Created

**Symptoms**:
- `npx rulesync generate` completes without errors
- Expected output files are missing (e.g., `.cursor/rules/`, `.claude/memories/`)

**Diagnostic Steps**:

1. **Check Rule Validation**:
   ```bash
   npx rulesync validate --verbose
   ```

2. **Use Verbose Generation**:
   ```bash
   npx rulesync generate --verbose
   ```

3. **Check Target Configuration**:
   ```bash
   # Check what tools are targeted
   grep -r "targets:" .rulesync/
   
   # Check configuration file
   cat rulesync.jsonc
   ```

**Common Causes and Solutions**:

1. **No Rules Target Specific Tools**:
   ```yaml
   # Problem: All rules target different tools
   targets: ["codexcli"]  # But you want cursor files
   
   # Solution: Update targets or use wildcard
   targets: ["*"]  # Generate for all tools
   ```

2. **Empty or Invalid Rules**:
   ```bash
   # Check for empty rule files
   find .rulesync -name "*.md" -size 0
   
   # Check for rules without content
   find .rulesync -name "*.md" -exec sh -c 'if [ $(grep -v "^---" "$1" | grep -v "^$" | wc -l) -eq 0 ]; then echo "Empty content: $1"; fi' _ {} \;
   ```

3. **Permission Issues**:
   ```bash
   # Check write permissions
   ls -la .cursor/
   ls -la .claude/
   
   # Fix permissions if needed
   chmod -R 755 .cursor/ .claude/
   ```

### Problem: Outdated Generated Files

**Symptoms**:
- Generated files don't reflect recent rule changes
- AI tools using old rule content

**Solutions**:

1. **Force Regeneration**:
   ```bash
   # Delete existing files and regenerate
   npx rulesync generate --delete --verbose
   ```

2. **Check File Timestamps**:
   ```bash
   # Compare timestamps
   ls -la .rulesync/*.md
   ls -la .cursor/rules/
   ls -la .claude/memories/
   ```

3. **Manual Cleanup**:
   ```bash
   # Remove generated files manually
   rm -rf .cursor/rules/
   rm -rf .claude/memories/
   rm -f CLAUDE.md GEMINI.md codex.md
   
   # Regenerate
   npx rulesync generate
   ```

## Import Issues

### Problem: Import Command Fails

**Symptoms**:
```bash
$ npx rulesync import --claudecode
Error: Cannot read file: CLAUDE.md
```

**Solutions**:

1. **Check Source Files Exist**:
   ```bash
   # Verify source files
   ls -la CLAUDE.md .claude/memories/
   ls -la .cursorrules .cursor/rules/
   ls -la .github/copilot-instructions.md
   ```

2. **Check File Permissions**:
   ```bash
   # Verify read permissions
   ls -la CLAUDE.md
   
   # Fix if needed
   chmod 644 CLAUDE.md
   ```

3. **Use Correct Import Flags**:
   ```bash
   # Available import options
   npx rulesync import --help
   
   # Tool-specific imports
   npx rulesync import --claudecode
   npx rulesync import --cursor
   npx rulesync import --copilot
   ```

### Problem: Import Creates Duplicate or Conflicting Content

**Symptoms**:
- Multiple similar rule files after import
- Conflicting guidance in different files

**Solutions**:

1. **Review Imported Files**:
   ```bash
   # List imported files
   ls -la .rulesync/
   
   # Check for similar content
   grep -r "TypeScript" .rulesync/
   grep -r "testing" .rulesync/
   ```

2. **Merge Similar Content**:
   ```bash
   # Identify duplicate themes
   find .rulesync -name "*typescript*"
   find .rulesync -name "*test*"
   
   # Manually merge and remove duplicates
   ```

3. **Use Tool Prefixes**:
   ```bash
   # Import creates tool-prefixed files to avoid conflicts
   ls -la .rulesync/claudecode-*
   ls -la .rulesync/cursor-*
   ```

## Performance Issues

### Problem: Slow Generation or Validation

**Symptoms**:
- Long wait times for `npx rulesync generate`
- Slow validation of rule files

**Diagnostic Steps**:

1. **Check Rule File Sizes**:
   ```bash
   # List files by size
   find .rulesync -name "*.md" -exec wc -w {} + | sort -n
   
   # Check total word count
   find .rulesync -name "*.md" -exec cat {} \; | wc -w
   ```

2. **Profile Generation**:
   ```bash
   # Time generation process
   time npx rulesync generate --verbose
   
   # Profile with debug output
   DEBUG=rulesync:* npx rulesync generate
   ```

**Solutions**:

1. **Optimize Rule Content**:
   ```markdown
   # Before: Very long rule file (3000+ words)
   # Split into focused rule files
   
   # After: Focused files (500-800 words each)
   .rulesync/overview.md          # Project context
   .rulesync/typescript-rules.md  # Language-specific
   .rulesync/testing-standards.md # Testing guidelines
   ```

2. **Reduce Rule Scope**:
   ```yaml
   # Instead of targeting all tools
   targets: ["*"]
   
   # Target only tools you use
   targets: ["cursor", "claudecode"]
   ```

3. **Optimize Glob Patterns**:
   ```yaml
   # Instead of broad patterns
   globs: ["**/*"]
   
   # Use specific patterns
   globs: ["src/**/*.ts", "components/**/*.tsx"]
   ```

### Problem: AI Tools Slow Response with Generated Rules

**Symptoms**:
- AI tools taking longer to respond
- Reduced quality of AI suggestions

**Solutions**:

1. **Check Generated File Sizes**:
   ```bash
   # Check Claude Code memory files
   find .claude/memories -name "*.md" -exec wc -w {} +
   
   # Check Cursor rule files
   find .cursor/rules -name "*.mdc" -exec wc -w {} +
   ```

2. **Optimize Rule Content**:
   ```markdown
   # Remove unnecessary content
   - Verbose explanations
   - Duplicate information
   - Outdated guidelines
   
   # Keep essential information
   - Core requirements
   - Key patterns
   - Critical constraints
   ```

3. **Use Tool-Specific Targeting**:
   ```yaml
   # Heavy rules only for specific tools
   ---
   targets: ["claudecode"]  # Only for Claude Code
   description: "Comprehensive architecture guidelines"
   ---
   
   # Light rules for performance-sensitive tools
   ---
   targets: ["cursor"]
   description: "Essential coding standards"
   ---
   ```

## AI Tool Integration Issues

### Problem: Claude Code Not Loading Rules

**Symptoms**:
- CLAUDE.md exists but AI doesn't seem to use it
- Memory files not being referenced

**Solutions**:

1. **Check File Format**:
   ```markdown
   # CLAUDE.md should be plain Markdown
   # No YAML frontmatter in generated file
   
   # Check for @import references
   grep "@" CLAUDE.md
   ```

2. **Verify File Location**:
   ```bash
   # CLAUDE.md should be in project root
   ls -la CLAUDE.md
   
   # Memory files should be in .claude/memories/
   ls -la .claude/memories/
   ```

3. **Test Manual Loading**:
   ```bash
   # In Claude Code, try reading the file manually
   # @CLAUDE.md
   ```

### Problem: Cursor Rules Not Activating

**Symptoms**:
- Generated .cursor/rules/*.mdc files exist
- Rules don't seem to apply in Cursor

**Solutions**:

1. **Check MDC Format**:
   ```bash
   # Verify MDC files have proper YAML frontmatter
   head -10 .cursor/rules/*.mdc
   ```

2. **Verify Rule Types**:
   ```yaml
   # Check that rule types are valid
   ---
   alwaysApply: true          # For always rules
   globs: ["**/*.ts"]         # For specific files
   description: "..."         # For intelligent rules
   ---
   ```

3. **Restart Cursor**:
   ```bash
   # Sometimes requires restart to load new rules
   # Close and reopen Cursor
   ```

### Problem: GitHub Copilot Not Using Instructions

**Symptoms**:
- Instruction files exist in .github/instructions/
- Copilot suggestions don't follow guidelines

**Solutions**:

1. **Check File Location and Format**:
   ```bash
   # Files should be in .github/instructions/
   ls -la .github/instructions/
   
   # Should have .instructions.md extension
   find .github/instructions -name "*.instructions.md"
   ```

2. **Verify Frontmatter**:
   ```yaml
   # Check YAML frontmatter format
   ---
   type: instruction
   description: "Brief description"
   patterns: ["**/*.ts", "**/*.tsx"]
   ---
   ```

3. **Test in GitHub Environment**:
   ```bash
   # Copilot custom instructions work best in GitHub Codespaces
   # or when repository is on GitHub
   ```

## Configuration Issues

### Problem: Configuration File Not Loading

**Symptoms**:
```bash
$ npx rulesync generate
Using default configuration (no config file found)
```

**Solutions**:

1. **Check Configuration File Names**:
   ```bash
   # Supported config file names
   ls -la rulesync.jsonc
   ls -la rulesync.ts
   ls -la rulesync.config.ts
   ls -la rulesync.config.jsonc
   ```

2. **Validate Configuration Syntax**:
   ```bash
   # For JSONC files
   # Check for valid JSON with comments
   
   # For TypeScript files
   npx tsc --noEmit rulesync.ts
   ```

3. **Use Explicit Config Path**:
   ```bash
   # Specify config file explicitly
   npx rulesync generate --config rulesync.jsonc
   ```

### Problem: Invalid Configuration Options

**Symptoms**:
```bash
Error: Invalid configuration option: invalidOption
```

**Solutions**:

1. **Check Valid Options**:
   ```jsonc
   {
     "targets": ["cursor", "claudecode"],
     "exclude": ["roo"],
     "delete": false,
     "verbose": true,
     "baseDir": "./packages",
     "aiRulesDir": ".rulesync",
     "aiCommandsDir": ".rulesync/commands"
   }
   ```

2. **Remove Invalid Options**:
   ```bash
   # Check configuration file for typos
   cat rulesync.jsonc
   ```

## Network and Dependency Issues

### Problem: MCP Server Connection Failures

**Symptoms**:
```bash
Error: MCP server 'github' failed to start
```

**Solutions**:

1. **Check MCP Configuration**:
   ```json
   {
     "mcpServers": {
       "github": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-github"],
         "env": {
           "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
         }
       }
     }
   }
   ```

2. **Test MCP Server Manually**:
   ```bash
   # Test server startup
   npx -y @modelcontextprotocol/server-github
   
   # Check environment variables
   echo $GITHUB_PERSONAL_ACCESS_TOKEN
   ```

3. **Check Network Connectivity**:
   ```bash
   # Test GitHub API access
   curl -H "Authorization: token $GITHUB_PERSONAL_ACCESS_TOKEN" \
        https://api.github.com/user
   ```

### Problem: Package Installation Errors

**Symptoms**:
```bash
npm ERR! network request to https://registry.npmjs.org/rulesync failed
```

**Solutions**:

1. **Check Network Connection**:
   ```bash
   # Test npm registry access
   npm ping
   
   # Test general connectivity
   ping registry.npmjs.org
   ```

2. **Try Alternative Registries**:
   ```bash
   # Use different registry
   npm install -g rulesync --registry https://registry.npmmirror.com/
   
   # Or use pnpm
   pnpm add -g rulesync
   ```

3. **Clear npm Cache**:
   ```bash
   npm cache clean --force
   npm install -g rulesync
   ```

## Emergency Recovery

### Complete Reset

If all else fails, perform a complete reset:

```bash
#!/bin/bash
# emergency-reset.sh

echo "=== rulesync Emergency Reset ==="

# 1. Backup current state
mkdir -p backup/$(date +%Y%m%d-%H%M%S)
cp -r .rulesync backup/$(date +%Y%m%d-%H%M%S)/ 2>/dev/null || true
cp rulesync.jsonc backup/$(date +%Y%m%d-%H%M%S)/ 2>/dev/null || true

# 2. Remove all generated files
rm -rf .cursor/rules/
rm -rf .claude/memories/
rm -rf .github/instructions/
rm -f CLAUDE.md GEMINI.md codex.md

# 3. Uninstall and reinstall rulesync
npm uninstall -g rulesync
npm install -g rulesync@latest

# 4. Validate environment
node --version
npm --version
rulesync --version

# 5. Re-initialize if needed
# npx rulesync init

echo "Reset complete. Check backup/ directory for previous state."
```

### Getting Help

If issues persist:

1. **Check Documentation**:
   - [GitHub Issues](https://github.com/your-org/rulesync/issues)
   - [Discussions](https://github.com/your-org/rulesync/discussions)

2. **Gather Debug Information**:
   ```bash
   # Create debug report
   echo "=== Debug Report ===" > debug-report.txt
   echo "Node version: $(node --version)" >> debug-report.txt
   echo "npm version: $(npm --version)" >> debug-report.txt
   echo "rulesync version: $(rulesync --version)" >> debug-report.txt
   echo "Platform: $(uname -a)" >> debug-report.txt
   echo "" >> debug-report.txt
   echo "=== Validation ===" >> debug-report.txt
   npx rulesync validate --verbose >> debug-report.txt 2>&1
   echo "" >> debug-report.txt
   echo "=== Generation ===" >> debug-report.txt
   npx rulesync generate --verbose --dry-run >> debug-report.txt 2>&1
   ```

3. **Create Minimal Reproduction**:
   ```bash
   # Create minimal test case
   mkdir rulesync-debug
   cd rulesync-debug
   npx rulesync init
   # Reproduce the issue with minimal setup
   ```

Remember: Most issues can be resolved by carefully following the error messages and checking the basics (file permissions, syntax, versions). When in doubt, start with a fresh setup and gradually add complexity.