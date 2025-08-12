---
root: false
targets: ["*"]
description: "Claude Code rules and memory system configuration specification"
globs: []
---

# Claude Code Rules and Memory System Configuration Specification

## Overview
Claude Code uses a hierarchical memory system to provide persistent context and project-specific instructions to the AI. This system allows developers to define coding standards, project guidelines, and operational constraints that are automatically included in every AI interaction.

## File Placement and Priority

### 1. Enterprise Policy (Highest Priority)
- **macOS**: `/Library/Application Support/ClaudeCode/managed-settings.json`
- **Linux/WSL**: `/etc/claude-code/managed-settings.json`
- **Windows**: `C:\ProgramData\ClaudeCode\managed-settings.json`
- **Purpose**: Organization-wide security policies and mandatory guidelines
- **Cannot be overridden**: Takes absolute precedence over all other configurations

### 2. Project Memory (Project-Specific)
- **Location**: `./CLAUDE.md` in repository root
- **Scope**: Shared with entire development team via version control
- **Purpose**: Project-specific guidelines, architecture patterns, and team standards
- **Priority**: Loaded after enterprise policy, can be overridden by user memory

### 3. User Memory (Personal)
- **Location**: `~/.claude/CLAUDE.md`
- **Scope**: Applied to all projects for the current user
- **Purpose**: Personal coding preferences and universal standards
- **Priority**: Loaded after project memory, highest user-configurable priority

### 4. Project-Local Memory (Deprecated)
- **Location**: `./CLAUDE.local.md`
- **Status**: Legacy support, use @import syntax instead
- **Purpose**: Personal project-specific overrides
- **Recommendation**: Migrate to separate files with @import references

### Loading Hierarchy
Memory files are loaded in the following order:
1. Enterprise policy (if exists)
2. Walk directory tree from current working directory to root, collecting CLAUDE.md files
3. User memory (`~/.claude/CLAUDE.md`)
4. Project-local memory (legacy, if exists)

Later files can override or add detail to earlier ones. All content is merged and prepended to every message sent to the AI model.

## File Format

### Format Requirements
- **File Format**: Plain Markdown (`.md`)
- **Encoding**: UTF-8
- **No Frontmatter**: Uses pure Markdown without YAML frontmatter
- **Size Recommendation**: Keep under 2000 words for optimal performance and cost efficiency

### Content Structure
The entire file content becomes part of the AI context. Structure content logically with clear headings:

```markdown
# Project: <ProjectName>
Brief project description (2-3 sentences)

## Tech Stack
- Primary language: TypeScript
- Framework: Next.js 14
- Package manager: pnpm
- Testing: Jest + Testing Library

## Coding Standards
1. Use TypeScript strict mode
2. Prefer functional components with hooks
3. Use meaningful variable names (camelCase)
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services

## Security Guidelines
- Never run `rm -rf` commands without explicit confirmation
- Ask before installing system-wide packages
- Validate all user inputs
- Use environment variables for secrets

## Build & Deployment Commands
### Development
```bash
pnpm install
pnpm dev
```

### Testing
```bash
pnpm test
pnpm test:watch
pnpm test:coverage
```

### Production
```bash
pnpm build
pnpm start
```

## Code Examples
### Preferred Component Structure
```typescript
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  const [user, setUser] = useState<User | null>(null);
  
  // Implementation here
  return <div>{/* JSX */}</div>;
};

export default UserProfile;
```

## Anti-patterns (What NOT to do)
- Don't use `any` type in TypeScript
- Avoid deep prop drilling (max 2 levels)
- Don't commit sensitive data or API keys
- Never use `var` declarations
```

## Import System

### @import Syntax
Claude Code supports importing other files using the `@` symbol followed by a file path:

```markdown
# Main Project Guidelines

See @README.md for project overview.

For detailed development workflow: @docs/development.md

## Git Guidelines
@docs/git-workflow.md

## Security Requirements
@security/security-guidelines.md
```

### Import Rules
- **Maximum Depth**: 5 levels of nested imports
- **Path Resolution**: Relative paths resolved from importing file's location
- **Personal Imports**: `@~/.claude/personal-preferences.md` for user-specific content
- **Code Exclusion**: Imports ignored inside code blocks to prevent accidental triggers

### Import Best Practices
- Use imports to keep main CLAUDE.md file concise
- Organize related content in separate files
- Keep sensitive information in user-level imports
- Use descriptive file names for clarity

## Memory Discovery in Large Repositories

### Lazy Loading
- Sub-directory CLAUDE.md files are loaded only when Claude reads files in those subtrees
- Helps manage token usage in large repositories
- Provides context-specific guidance for different modules

### Example Structure
```
repo/
├── CLAUDE.md                    # Main project guidelines
├── docs/
│   └── contributing.md         # Referenced via @import
├── frontend/
│   └── CLAUDE.md              # Frontend-specific rules
└── backend/
    └── CLAUDE.md              # Backend-specific rules
```

## Memory Management

### Quick Memory Addition
Start any message with `#` to save it as a memory:
```
# Use camelCase for variable names
# Prefer const over let when possible
```
Claude will ask where to store this information.

### Interactive Memory Management
- **Command**: `/memory`
- **Function**: Opens chosen memory file in system editor
- **Usage**: Edit or inspect memories during development session

### Memory Initialization
- **Command**: `/init`
- **Function**: Bootstrap a starter CLAUDE.md in repository root
- **Content**: Creates basic project template with common sections

## Configuration Examples

### Global User Memory (`~/.claude/CLAUDE.md`)
```markdown
# Personal Development Guidelines

## Editor Preferences
- Use VS Code with TypeScript extensions
- Enable format on save
- Use 2-space indentation for JS/TS, 4 for Python

## Safety Rules
- Always ask for confirmation before running destructive commands
- Never execute `rm -rf` without explicit user approval
- Validate paths before file operations

## Code Quality Standards
- Write descriptive commit messages
- Include error handling in all functions
- Use meaningful variable names
- Maintain minimum 80% test coverage

## Testing Philosophy
- Write tests before implementing features (TDD)
- Test edge cases and error conditions
- Use descriptive test names
```

### Project Memory (`CLAUDE.md`)
```markdown
# E-commerce Platform

Modern e-commerce platform built with Next.js and TypeScript.

## Architecture
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes
- Database: PostgreSQL with Prisma ORM
- Styling: Tailwind CSS
- Authentication: NextAuth.js

## Development Workflow
@docs/development-setup.md

## Database Guidelines
- Use Prisma schema for all database changes
- Run migrations in order: dev → staging → production
- Always backup before schema changes

## API Design
@docs/api-standards.md

## Component Standards
@docs/component-guidelines.md
```

### Module-Specific Memory (`frontend/CLAUDE.md`)
```markdown
# Frontend Module Guidelines

## Component Library Standards
- One component per file
- Use TypeScript interfaces for props
- Implement proper error boundaries
- Follow atomic design principles

## File Organization
```
src/
├── components/
│   ├── atoms/
│   ├── molecules/
│   └── organisms/
├── pages/
├── hooks/
└── utils/
```

## Testing Requirements
- Unit tests for all components
- Accessibility tests using @testing-library/jest-dom
- Visual regression tests for complex components

## Performance Guidelines
- Use React.memo for expensive components
- Implement lazy loading for routes
- Optimize bundle size with dynamic imports
```

## Integration with Other Tools

### Version Control
- Commit CLAUDE.md files to repository for team sharing
- Use `.gitignore` to exclude user-specific global memories
- Include memory changes in code review process

### CI/CD Integration
- Reference coding standards in PR templates
- Validate memory file syntax in CI pipeline
- Ensure consistency across environments

### IDE Integration
- Memory files work seamlessly with any IDE
- Use IDE's Markdown preview for easy editing
- Syntax highlighting improves readability

## Advanced Features

### Memory Validation
Claude Code automatically validates memory content and provides feedback on:
- Conflicting guidelines
- Outdated information
- Missing essential project information

### Context Management
- Memories are automatically included in AI context
- Token usage is optimized through lazy loading
- Large memories are summarized when necessary

### Team Collaboration
1. **Establish Standards**: Create project memories early in development
2. **Regular Reviews**: Update memories as project evolves
3. **Team Alignment**: Ensure all team members understand guidelines
4. **Documentation Sync**: Keep memories consistent with project documentation

## Troubleshooting

### Common Issues
1. **Memory not applied**: Check file location and name (CLAUDE.md, not CLAUDE.txt)
2. **Conflicting rules**: Review memory hierarchy and precedence
3. **Performance issues**: Reduce memory file size if responses are slow
4. **Inconsistent behavior**: Clear memory conflicts between files

### Debug Commands
- `/memory` - Edit or inspect memory files
- `/config` - View current configuration
- `/doctor` - Diagnose configuration issues

### Best Practices
- Keep memories concise and focused
- Use clear, actionable guidelines
- Regular review and updates
- Test memory effectiveness through AI interactions
- Document memory rationale for team understanding

## Migration from Other AI Tools

### From Other Memory Systems
Convert existing instruction files to Claude Code format:
```bash
# Copy and adapt existing rules
cp .cursorrules CLAUDE.md
cp instructions.md CLAUDE.md

# Remove any YAML frontmatter if present
# Adapt syntax to pure Markdown format
# Add @import references for modular organization
```

### Memory File Organization
- Start with single CLAUDE.md file
- Split into modules as project grows
- Use @import syntax for organization
- Keep related content together

This specification provides comprehensive guidance for configuring Claude Code's memory system, enabling consistent and effective AI-assisted development workflows through persistent context and project-specific instructions.