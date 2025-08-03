---
root: false
targets: ["*"]
description: "Windsurf AI code editor rules and memories configuration specification"
globs: []
---

# Windsurf AI Code Editor Rules and Memories Configuration Specification

## Overview
Windsurf allows you to "teach" its Cascade AI through three different mechanisms: global rules, workspace/project rules, and auto-generated memories. These provide persistent context and project-specific instructions to enhance AI-assisted development workflows.

## Configuration Types

### 1. Global Rules

#### File Location
- **File**: `global_rules.md`
- **macOS/Linux**: `~/.codeium/windsurf/memories/global_rules.md`
- **Windows**: `%USERPROFILE%\.codeium\windsurf\memories\global_rules.md`

#### Purpose
Company-wide or personal standards that should be enforced everywhere, such as:
- Naming schemas
- Commit message style
- Preferred licenses
- Coding conventions

#### Creation Methods
1. **Via UI**: Windsurf → Settings → Rules → "+ Global"
2. **Manual**: Create the file manually at the specified path and restart Windsurf

#### Specifications
- **Format**: Plain Markdown text
- **Size Limit**: Up to 12,000 characters
- **Precedence**: If combined global + workspace rules exceed 12,000 chars, global rules take priority

### 2. Workspace/Project Rules

#### File Locations and Variants

##### A. Single-File Variant
- **File**: `.windsurf-rules`
- **Location**: Project root directory
- **Visibility**: Can be added to `.gitignore` if not meant to be committed

##### B. Directory Variant (Recommended)
- **Directory**: `.windsurf/rules/`
- **Location**: Anywhere inside the repository
- **Files**: One or many Markdown/MDX files, each describing different rule sets
- **Discovery**: Windsurf automatically discovers every `.windsurf/rules` directory:
  - Current folder and its sub-directories
  - Parent directories up to the Git root
  - All open workspaces (duplicates are deduped)

#### Activation Modes
Each rule can be configured with different activation modes:

1. **Always-On**: Rule is injected in every prompt
2. **Manual**: Only when you @mention it explicitly
3. **Model-Decision**: Model decides when the rule is relevant
4. **Glob**: Apply only when editing files that match a glob pattern (e.g., `**/*.tsx`)

#### Configuration Format
Rules can include YAML-like headers to specify activation modes and other metadata.

#### Specifications
- **Format**: Markdown or MDX
- **Size Limit**: Up to 12,000 characters per file
- **Multiple Files**: Supported in `.windsurf/rules/` directory
- **Scope**: Workspace-specific

### 3. Auto-Generated Memories

#### Functionality
- Cascade automatically stores facts it considers important (e.g., "frontend uses UI library v3")
- Manual creation via chat command: "create a memory of ..."
- Scoped to current workspace, not shared across projects

#### Management
- **Access**: Windsurf → Settings → Manage Memories
- **Storage**: Private memory database (UI-managed)
- **Cost**: Auto-generated memories do NOT count against usage credits

## File Format and Best Practices

### Recommended Markdown Structure
```markdown
# Coding Standards
- Language: Python 3.12
- Enforce black code-style (line-length = 88)
- Always add type hints

<security>
- Never hard-code credentials
- Prefer dotenv for secrets
</security>
```

### Content Guidelines
1. **Be Specific**: Include concrete examples and patterns
2. **Structure Clearly**: Use headers and bullet points
3. **Security First**: Emphasize security practices
4. **Technology Stack**: Specify versions and preferred tools

## Setup Workflow

### Quick Setup Recipe
1. **Global Rules**: Write organization-wide rules in `~/.codeium/windsurf/memories/global_rules.md`
2. **Project Rules**: Add `.windsurf-rules` file or `.windsurf/rules/` folder with:
   - Tech stack versions
   - Project conventions (e.g., "use React 18 + Vite")
   - Test coverage targets
3. **Verification**: Open Windsurf → Settings → Rules, verify both global and workspace rules show as "Always On"
4. **Memory Creation**: Use chat to create project-specific memories for invariants

### File Structure Examples

#### Simple Project Structure
```
project-root/
├── .windsurf-rules          # Single-file rules
├── .gitignore
└── src/
```

#### Advanced Project Structure
```
project-root/
├── .windsurf/
│   └── rules/
│       ├── coding-standards.md
│       ├── security-rules.md
│       └── testing-guidelines.md
├── .gitignore
└── src/
```

## Rule Content Examples

### Global Rules Example
```markdown
# Company Coding Standards

## General Principles
- Always use TypeScript for new projects
- Follow semantic versioning
- Write comprehensive tests

## Security Requirements
- Never commit API keys or secrets
- Use environment variables for configuration
- Validate all user inputs

## Documentation
- README files must include setup instructions
- All public APIs must be documented
- Use JSDoc for TypeScript functions
```

### Project Rules Example
```markdown
# Project-Specific Rules

## Tech Stack
- React 18 with TypeScript
- Vite for build tooling
- Vitest for testing
- Tailwind CSS for styling

## Architecture
- Use custom hooks for business logic
- Components in `src/components/`
- Utilities in `src/utils/`
- Types in `src/types/`

## Testing Strategy
- Unit tests for all utility functions
- Component tests for complex UI logic
- E2E tests for critical user flows
- Minimum 80% code coverage
```

## Advanced Features

### Rule Activation with Headers
```markdown
---
activation: glob
pattern: "**/*.tsx"
---

# React Component Rules
- Use functional components with hooks
- Implement proper TypeScript interfaces
- Include proper accessibility attributes
```

### Conditional Rules
```markdown
# Backend Development Rules
<!-- Only apply when working on backend files -->

## API Design
- RESTful endpoints with consistent naming
- Proper HTTP status codes
- Comprehensive error handling

## Database
- Use migrations for schema changes
- Index frequently queried columns
- Implement proper data validation
```

## Integration with Other Tools

### Version Control
- Commit `.windsurf/rules/` to share with team
- Use `.gitignore` for personal `.windsurf-rules` files
- Include rule changes in PR reviews

### Team Collaboration
- Establish team standards for rule organization
- Use global rules for company-wide standards
- Use project rules for specific requirements
- Document rule purposes and exceptions

## Best Practices

### Rule Organization
1. **Separate Concerns**: Different rule files for different aspects
2. **Clear Naming**: Descriptive file names in `.windsurf/rules/`
3. **Size Management**: Keep individual files under 12,000 characters
4. **Regular Updates**: Review and update rules as projects evolve

### Content Quality
1. **Specific Examples**: Include code examples where appropriate
2. **Clear Language**: Use precise, unambiguous language
3. **Actionable Rules**: Ensure rules provide clear guidance
4. **Context Awareness**: Include project-specific context

### Maintenance
1. **Regular Review**: Update rules as technologies and practices evolve
2. **Team Feedback**: Gather feedback on rule effectiveness
3. **Memory Integration**: Use memories for dynamic project facts
4. **Rule Validation**: Test rule effectiveness through AI interactions

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check file paths and restart Windsurf
2. **Size Limits**: Split large rule files into smaller, focused files
3. **Conflicting Rules**: Review rule precedence and remove conflicts

### Verification Steps
1. **Check Settings**: Windsurf → Settings → Rules to verify rule loading
2. **Test Application**: Ask Cascade about project conventions
3. **Memory Review**: Check auto-generated memories for accuracy

This specification provides comprehensive guidance for configuring Windsurf's rule and memory system to enhance AI-assisted development workflows with project-specific context and coding standards.