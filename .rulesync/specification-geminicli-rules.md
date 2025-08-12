---
root: false
targets: ["*"]
description: "Gemini CLI Memory (GEMINI.md) specification for configuration file generation"
globs: []
---

# Gemini CLI Memory (GEMINI.md) Specification

## Overview
Gemini CLI uses a memory system to provide persistent context and project-specific instructions to the AI. This system allows developers to define coding standards, project guidelines, and operational constraints that are automatically included in every AI interaction.

## File Placement and Priority

### Memory File Discovery
Gemini CLI's memory discovery service searches for context files in this order:
1. **Global Memory**: `$HOME/.gemini/GEMINI.md` (user-wide settings)
2. **Project Memory**: Current directory → parent directories up to Git root
3. **Sub-directory Memory**: Subdirectories beneath current working directory (excluding node_modules, .git, etc.)

### Multiple File Handling
- Text from all discovered files is concatenated
- Later (more specific) files override or supplement earlier ones
- Final combined prompt can be inspected with `/memory show`

### Custom Context Filename
Override the default filename in `~/.gemini/settings.json` or `.gemini/settings.json`:

```json
{
  "contextFileName": "MY_RULES.md",        // single string
  "contextFileName": ["RULES.md", "DOCS.md"], // array of filenames
  "contextFileName": []                    // disable memory loading
}
```

## File Format

### Format Requirements
- **File Format**: Plain Markdown (`.md`)
- **Encoding**: UTF-8
- **No Frontmatter**: Unlike other AI tools, Gemini CLI uses pure Markdown without YAML frontmatter
- **Size Recommendation**: Keep concise to optimize token usage and cost efficiency

### Content Structure
The entire file content becomes part of the AI system prompt. Structure content logically with clear headings:

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

## Gemini Added Memories
(This section is auto-populated by the save_memory tool)
```

## Runtime Commands

### Built-in Memory Commands
- `/memory add <text>` - Append text to the nearest writable GEMINI.md file
- `/memory show` - Display the full concatenated memory content
- `/memory refresh` - Rescan and rebuild memory cache after manual edits

### Programmatic Memory API
Use the `save_memory` tool within prompts or tool implementations:

```python
save_memory(fact="My preferred language is Rust.")
```

The CLI appends facts as bullets under "## Gemini Added Memories" section in the appropriate GEMINI.md file.

## Configuration Management

### Disabling Memory
Disable memory loading in settings:
```json
{
  "contextFileName": []
}
```

### Debug Memory Loading
To verify which memory files are being loaded:
```bash
gemini /memory show
```

This displays the complete concatenated memory content that gets injected into every AI interaction.

## Best Practices

### Content Guidelines
1. **Keep it concise**: Focus on essential project-specific information
2. **Be specific**: Provide concrete examples rather than vague principles  
3. **Include examples**: Show preferred code patterns and structures
4. **Prioritize by importance**: Most critical rules should be at the top
5. **Use clear headings**: Organize content with descriptive section headers

### Global Memory (`~/.gemini/GEMINI.md`)
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

### Project Memory (`GEMINI.md`)
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

### Directory-Specific Memory (`src/components/GEMINI.md`)
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
- Commit `GEMINI.md` files to repository for team sharing
- Use `.gitignore` to exclude user-specific global memory
- Include memory changes in code review process

### CI/CD Integration
- Reference coding standards in PR templates
- Validate memory file syntax in CI pipeline
- Ensure consistency across environments

### Team Collaboration
1. **Establish standards**: Create project memory early in development
2. **Regular reviews**: Update memory as project evolves
3. **Team alignment**: Ensure all team members understand and follow guidelines
4. **Documentation sync**: Keep memory consistent with project documentation

## Advanced Configuration

### Environment-Specific Memory
While Gemini CLI doesn't natively support environment-specific memory, you can implement this pattern:

```markdown
# Project Memory

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

### Conditional Logic in Memory
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
1. **Memory not applied**: Check file location and name (`GEMINI.md`, not `GEMINI.txt`)
2. **Conflicting rules**: Review memory hierarchy and priority
3. **Performance issues**: Reduce memory file size if responses are slow
4. **Inconsistent behavior**: Clear memory conflicts between files

### Validation and Testing
- Test memory effectiveness by observing AI responses
- Monitor code generation quality and adherence to guidelines
- Collect team feedback on memory clarity and usefulness
- Regular review and updates to keep memory current

### Memory Size Optimization
- Keep individual memory files under 2000 words
- Use bullet points and numbered lists for clarity
- Include specific code examples rather than abstract principles
- Remove outdated or conflicting information regularly

## Migration from Other AI Tools

### From Cursor Rules
Convert `.cursorrules` content to `GEMINI.md`:
```bash
# Copy and adapt existing rules
cp .cursorrules GEMINI.md
# Remove any YAML frontmatter if present
# Adapt syntax to pure Markdown format
```

### From Claude Code Memory
Convert `CLAUDE.md` to `GEMINI.md`:
- Copy content from CLAUDE.md
- Remove any @-references to other files
- Consolidate multiple memory files into single GEMINI.md
- Adapt content structure to Gemini format

This specification provides comprehensive guidance for configuring Gemini CLI memory files, enabling consistent and effective AI-assisted development workflows.