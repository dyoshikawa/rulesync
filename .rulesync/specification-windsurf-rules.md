---
root: false
targets: ["windsurf"]
description: "Windsurf AI assistant rules and memories configuration specification"
globs: ["**/*.md", ".windsurf/rules/**/*", ".windsurfrules.md", "~/.codeium/windsurf/memories/**/*"]
---

# Windsurf AI Assistant Rules and Memories Configuration Specification

## Overview
Windsurf treats "rules" and "memories" as plain-text Markdown files that live alongside (or outside) your codebase. The assistant (Cascade) reads them on every request and decides what to inject into the model's context.

## File Placement and Structure

### Global Configuration (applies to every workspace)
- **Global Rules**: `~/.codeium/windsurf/memories/global_rules.md`
- **Memories Directory**: `~/.codeium/windsurf/memories/` (each .md file becomes an addressable memory)

### Per-Workspace / Per-Repository Configuration
- **Preferred**: `.windsurf/rules/` directory (can contain multiple .md files)
- **Alternative**: `.windsurfrules.md` at the project root (single-file style, still supported)
- **Component-Level**: `.cicdrules.md`, `.iamrolerules.md`, etc. at repo root for specialized domains

### Directory Structure Discovery
- Windsurf walks upward from any sub-directory to the git root
- De-duplicates rule files found during upward traversal
- Multiple `.windsurf/rules/` directories can exist in different levels

## File Format and Syntax

### Basic Structure
- **File Type**: Markdown (.md) only
- Everything that is not a comment becomes possible model context
- Keep content concise due to character limits

### Typical File Template
```markdown
# Rule: Coding Style Guidelines
# Suggested Activation: Always On

<naming_conventions>
- Components: PascalCase
- Functions: camelCase
- CONSTANTS: UPPER_SNAKE_CASE
</naming_conventions>

## Function Guidelines
1. Maximum 30 LOC per function
2. Prefer early returns
3. Exported functions MUST have JSDoc
```

### Formatting Best Practices
- **Bullet Points/Numbered Lists**: Easier for Cascade to follow than prose
- **XML-Style Tags**: Optional grouping (`<coding_guidelines>...</coding_guidelines>`)
- **Code-Fenced Examples**: Embed code samples, diagrams, or links to other rules
- **Structured Content**: Use clear headings and sections

## Activation Modes

### Mode Types
Each rule file can declare one of four activation modes:

| Mode Name | Behavior |
|-----------|----------|
| **Always On** | Injected on every assistant request |
| **Manual** | Only injected when you @mention the rule name |
| **Model Decision** | AI decides contextually whether to include it |
| **Glob** | Applied when the current file matches a glob pattern |

### Mode Declaration Syntax

#### Comment-Based Declaration
```markdown
# Suggested Activation: Always On
# Files: src/**/*.js
```

#### YAML Front-Matter Declaration
```yaml
---
activation: glob
files: ["src/**/*.js"]
---
```

### Glob Pattern Examples
- `*.js` - All JavaScript files
- `src/**/*.ts` - All TypeScript files in src directory and subdirectories
- `**/*.test.js` - All test files anywhere in the project

## Size and Character Limits

### Per-File Limits
- **Individual File**: 6,000–12,000 characters per rule file
- **Combined Total**: 12,000 characters (global + local combined)
- **Truncation Behavior**: If exceeded, Windsurf truncates beginning with lowest-priority workspace rules

### Memory Management
- Auto-generated memories stored in `~/.codeium/windsurf/memories/`
- Memories are created interactively ("Cascade, create a memory of...")
- View/delete memories through "Customizations → Memories" panel in IDE
- Do not edit auto-generated memories directly

## Rules vs. Memories

### Rules
- **Purpose**: Explicit, hand-written guardrails the AI must follow
- **Location**: `.windsurf/rules/` or `.windsurfrules.md`
- **Management**: Created and edited manually
- **Activation**: Controlled by activation modes

### Memories
- **Purpose**: Facts or decisions captured interactively
- **Location**: `~/.codeium/windsurf/memories/`
- **Management**: Auto-generated, managed through IDE interface
- **Activation**: Automatically surfaced by relevance

## Project Setup Recipe

### Quick Setup Steps
1. Create directory: `mkdir .windsurf/rules`
2. Add 2-3 focused Markdown files:
   - `architecture.md` - System architecture guidelines
   - `code-style.md` - Coding standards and conventions
   - `security.md` - Security requirements and practices
3. Start each file with `# Suggested Activation: Always On`
4. Keep each file under ~5,000 chars to stay below global cap
5. Commit directory for team consistency
6. Optional: Add specialized rules (`.cicdrules.md` for CI/CD standards)
7. Optional: Create `windsurf_workflows/` directory for AI-driven dev workflows

### File Organization Best Practices
- **Domain Separation**: Separate rules by concern (architecture, style, security)
- **Team Consistency**: Commit rule files to version control
- **Size Management**: Monitor combined character count
- **Regular Review**: Update rules as project evolves

## Integration with Windsurf Features

### Cascade AI Assistant
- Rules automatically loaded on every request
- Context injection based on activation mode
- Respects character limits and priority system

### Workflow Integration
- Rules applied during automated workflow execution
- Consistent behavior across chat, completion, and workflows
- Team-wide standardization through version-controlled rules

### UI Controls
- Toggle activation modes through Windsurf UI
- View active rules in assistant panel
- Memory management through customizations panel

## Advanced Configuration

### Rule Priority System
1. **Global Rules**: Lowest priority (truncated first if over limit)
2. **Workspace Rules**: Higher priority
3. **File-Specific Rules**: Highest priority (glob-matched rules)

### Contextual Application
- Rules automatically applied based on current file context
- Glob patterns determine file-specific rule activation
- AI model decides relevance for "Model Decision" mode rules

### Team Collaboration
- Version control `.windsurf/rules/` directory
- Standardize rule formats across team
- Document rule purposes and activation strategies
- Regular rule review and maintenance

## Troubleshooting

### Common Issues
- **Rules Not Applied**: Check activation mode and file placement
- **Character Limit Exceeded**: Split large rules into smaller, focused files
- **Inconsistent Behavior**: Verify rule conflicts and priority order
- **Memory Issues**: Clean up unused memories through IDE panel

### Best Practices
- Keep rules focused and concise
- Use descriptive file names
- Test rule activation with different file types
- Monitor combined character usage
- Document rule purposes for team understanding

