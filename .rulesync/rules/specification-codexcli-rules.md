---
root: false
targets: ["*"]
description: "OpenAI Codex CLI instructions and memory file specification"
globs: []
---

# OpenAI Codex CLI Rules/Memory Configuration Specification

## Overview
OpenAI Codex CLI uses a memory/instructions system to provide persistent context and project-specific rules to the AI. This system allows developers to define coding standards, project guidelines, and operational constraints that are automatically included in every AI interaction.

## File Placement and Priority

### 1. Global User Instructions
- **Location**: `~/.codex/instructions.md`
- **Scope**: Applied to all projects for the current user
- **Purpose**: Personal coding preferences, general safety rules, and universal standards
- **Priority**: Loaded first (lowest priority)

### 2. Project-Level Instructions  
- **Location**: `<project-root>/AGENTS.md`
- **Scope**: Specific to the current project/repository
- **Purpose**: Project-specific guidelines, architecture patterns, and team standards
- **Priority**: Loaded second (medium priority)

### 3. Directory-Specific Instructions
- **Location**: `<current-working-directory>/AGENTS.md`
- **Scope**: Sub-package or folder-specific rules
- **Purpose**: Module-specific guidelines, specialized rules for subdirectories
- **Priority**: Loaded last (highest priority)

### Priority and Merging Behavior
Instructions are concatenated in the following order:
1. `~/.codex/instructions.md` (global)
2. `<project-root>/AGENTS.md` (project)  
3. `<cwd>/AGENTS.md` (directory-specific)

Later files can override or add detail to earlier ones. The merged Markdown content is prepended to every message sent to the AI model.

## File Format

### Format Requirements
- **File Format**: Plain Markdown (`.md`)
- **Encoding**: UTF-8
- **No Frontmatter**: Unlike other AI tools, Codex CLI uses pure Markdown without YAML frontmatter
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

## Configuration Management

### Disabling Project Instructions
You can disable project-level instruction loading using:
- **CLI Flag**: `--no-project-doc`
- **Environment Variable**: `CODEX_DISABLE_PROJECT_DOC=1`

### Debug Configuration Loading
To verify which instruction files are being loaded:
```bash
# Enable debug mode to see loaded files
CODEX_DEBUG_CONFIG=1 codex
# or
codex doctor
```

## Best Practices

### Content Guidelines
1. **Keep it concise**: Focus on essential project-specific information
2. **Be specific**: Provide concrete examples rather than vague principles  
3. **Include examples**: Show preferred code patterns and structures
4. **Prioritize by importance**: Most critical rules should be at the top
5. **Use clear headings**: Organize content with descriptive section headers

### Global Instructions (`~/.codex/instructions.md`)
```markdown
# Global Development Guidelines

## Safety Rules
- Always ask for confirmation before running destructive commands
- Never execute `rm -rf` without explicit user approval
- Validate paths before file operations

## Code Quality Standards
- Use consistent indentation (2 spaces for JS/TS, 4 for Python)
- Write descriptive commit messages
- Include error handling in all functions
- Use meaningful variable names

## Testing Philosophy
- Write tests before implementing features (TDD)
- Maintain minimum 80% code coverage
- Test edge cases and error conditions
```

### Project Instructions (`AGENTS.md`)
```markdown
# E-commerce Platform

This is a modern e-commerce platform built with Next.js and TypeScript.

## Architecture
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes
- Database: PostgreSQL with Prisma ORM
- Styling: Tailwind CSS
- Authentication: NextAuth.js

## Development Workflow
### Setup
```bash
pnpm install
cp .env.example .env.local
pnpm db:push
```

### Daily Development
```bash
pnpm dev      # Start development server
pnpm test     # Run test suite
pnpm lint     # Check code quality
```

## Database Guidelines
- Use Prisma schema for all database changes
- Run migrations in order: dev → staging → production
- Always backup before schema changes

## API Design
- Use RESTful conventions
- Include proper error handling
- Implement rate limiting for public endpoints
- Return consistent JSON response format

## Component Standards
- One component per file
- Use TypeScript interfaces for props
- Implement proper error boundaries
- Follow atomic design principles
```

### Directory-Specific Instructions (`src/components/AGENTS.md`)
```markdown
# Component Library Guidelines

## File Organization
- One component per file
- Co-locate tests with components
- Use index.js for clean imports

## Component Structure
```typescript
// Button.tsx
import { ReactNode } from 'react';
import styles from './Button.module.css';

interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  onClick,
  disabled = false
}) => {
  return (
    <button 
      className={`${styles.button} ${styles[variant]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};
```

## Testing Requirements
- Unit tests for all components
- Accessibility tests using @testing-library/jest-dom
- Visual regression tests for complex components
```

## Integration with Other Tools

### Version Control
- Commit `AGENTS.md` files to repository for team sharing
- Use `.gitignore` to exclude user-specific global instructions
- Include instruction changes in code review process

### CI/CD Integration
- Reference coding standards in PR templates
- Validate instruction file syntax in CI pipeline
- Ensure consistency across environments

### Team Collaboration
1. **Establish standards**: Create project instructions early in development
2. **Regular reviews**: Update instructions as project evolves
3. **Team alignment**: Ensure all team members understand and follow guidelines
4. **Documentation sync**: Keep instructions consistent with project documentation

## Advanced Configuration

### Environment-Specific Instructions
While Codex CLI doesn't natively support environment-specific instructions, you can implement this pattern:

```markdown
# Project Instructions

## Environment-Specific Guidelines

### Development
- Use local database connections
- Enable verbose logging
- Allow experimental features

### Production  
- Use production database connections
- Minimize logging output
- Disable debug features
- Require manual approval for destructive operations
```

### Conditional Logic in Instructions
```markdown
# Conditional Guidelines

## Platform-Specific Rules
When working on:
- **Frontend components**: Follow React/TypeScript guidelines
- **API endpoints**: Follow Node.js/Express patterns  
- **Database models**: Follow Prisma schema conventions
- **Deployment scripts**: Follow DevOps security practices
```

## Troubleshooting

### Common Issues
1. **Instructions not applied**: Check file location and name (`AGENTS.md`, not `codex.txt`)
2. **Conflicting rules**: Review instruction hierarchy and priority
3. **Performance issues**: Reduce instruction file size if responses are slow
4. **Inconsistent behavior**: Clear instruction conflicts between files

### Validation and Testing
- Test instruction effectiveness by observing AI responses
- Monitor code generation quality and adherence to guidelines
- Collect team feedback on instruction clarity and usefulness
- Regular review and updates to keep instructions current

## Migration from Other AI Tools

### From Cursor Rules
Convert `.cursorrules` content to `AGENTS.md`:
```bash
# Copy and adapt existing rules
cp .cursorrules AGENTS.md
# Remove any YAML frontmatter if present
# Adapt syntax to pure Markdown format
```

### From GitHub Copilot Instructions
Convert `.github/copilot-instructions.md` to `AGENTS.md`:
- Remove YAML frontmatter
- Adapt content structure to Codex format
- Consolidate multiple instruction files into single `AGENTS.md`

This specification provides comprehensive guidance for configuring OpenAI Codex CLI instructions and memory files, enabling consistent and effective AI-assisted development workflows.