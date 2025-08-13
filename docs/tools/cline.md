# Cline Integration

## Overview

Cline (formerly Claude Dev) uses a simple, clean approach with plain Markdown rule files. rulesync generates organized rule files that integrate seamlessly with Cline's instruction system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Rules** | `.clinerules/*.md` | Rule files in plain Markdown |
| **Main Instructions** | `.cline/instructions.md` | Primary instruction file |
| **MCP Configuration** | `.cline/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.clineignore` | File exclusion patterns |

## Rule Format

Cline uses clean, plain Markdown files without complex frontmatter:

```markdown
# TypeScript Development Rules

## Coding Standards
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use meaningful variable names

## Architecture Guidelines
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services

## Testing Requirements
- Write unit tests for all business logic
- Use Jest and Testing Library
- Maintain minimum 80% code coverage
```

## Rule Processing

### Root Rules
- **Target**: Main `.cline/instructions.md` file
- **Content**: Project overview and high-level guidelines
- **Format**: Plain Markdown with clear structure

### Non-Root Rules
- **Target**: Individual files in `.clinerules/` directory
- **Content**: Specific implementation rules and detailed guidelines
- **Organization**: One file per rule category

## Usage Examples

### Generate Cline Configuration

```bash
# Generate only for Cline
npx rulesync generate --cline

# Generate with verbose output
npx rulesync generate --cline --verbose

# Generate in specific directory
npx rulesync generate --cline --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Cline setup
npx rulesync import --cline

# This imports from:
# - .cline/instructions.md
# - .clinerules/*.md files
```

## File Organization

### Standard Structure
```
.cline/
└── instructions.md              # Main instructions (root rules)

.clinerules/
├── typescript-standards.md     # Language-specific rules
├── testing-guidelines.md       # Testing requirements
├── security-rules.md           # Security guidelines
└── architecture-patterns.md    # Design patterns
```

### Content Organization

**Main Instructions** (`.cline/instructions.md`):
- Project overview and philosophy
- Core development principles
- High-level architecture guidelines
- Team collaboration standards

**Detailed Rules** (`.clinerules/*.md`):
- Specific coding standards
- Framework-specific guidelines
- Tool configurations
- Detailed implementation patterns

## Integration Benefits

### Developer Experience
- **Clean Interface**: No complex configuration syntax
- **Readable Rules**: Plain Markdown is easy to read and maintain
- **Quick Updates**: Simple file editing for rule changes
- **Version Control**: Rules integrate naturally with Git workflow

### AI Assistant Enhancement
- **Clear Context**: Well-structured rules provide clear guidance
- **Focused Assistance**: Rules help AI understand project patterns
- **Consistent Output**: AI generates code following established patterns
- **Reduced Iterations**: Better initial code generation reduces back-and-forth

## Rule Examples

### Project Standards
```markdown
# Project Development Standards

## Technology Stack
- Node.js 20+ with TypeScript
- React 18 with functional components
- Tailwind CSS for styling
- Vitest for testing

## Code Quality
- Use ESLint and Prettier for formatting
- Write descriptive commit messages
- Include JSDoc comments for public APIs
- Follow semantic versioning
```

### Security Guidelines
```markdown
# Security Rules

## Data Protection
- Never commit secrets or API keys
- Use environment variables for configuration
- Validate all user inputs
- Implement proper error handling

## Authentication
- Use secure session management
- Implement proper RBAC
- Log security events
- Regular dependency updates
```

### Testing Standards
```markdown
# Testing Guidelines

## Unit Testing
- Test all business logic functions
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies

## Integration Testing
- Test API endpoints thoroughly
- Validate database interactions
- Test error scenarios
- Check edge cases
```

## Advanced Features

### Conditional Rules
While Cline doesn't support conditional application like Cursor, you can organize rules by context:

```markdown
# Frontend Component Rules

These rules apply when working on React components:

## Component Structure
- Use functional components with hooks
- Implement proper TypeScript interfaces
- Include accessibility attributes
```

### Multi-Environment Guidelines
```markdown
# Environment-Specific Rules

## Development
- Enable verbose logging
- Use development database
- Allow experimental features

## Production
- Minimize logging output
- Use production configurations
- Require manual deployment approval
```

## Best Practices

### Rule Organization
1. **Single Responsibility**: Each rule file covers one topic
2. **Clear Hierarchy**: Use consistent heading structure
3. **Actionable Content**: Provide specific, implementable guidance
4. **Regular Maintenance**: Update rules as project evolves

### Content Guidelines
1. **Plain Language**: Use clear, simple language
2. **Concrete Examples**: Include code examples where helpful
3. **Consistent Format**: Maintain similar structure across files
4. **Relevant Scope**: Keep rules focused on specific contexts

### Team Collaboration
1. **Shared Understanding**: Ensure all team members understand rules
2. **Regular Reviews**: Update rules based on team feedback
3. **Documentation Sync**: Keep rules aligned with project documentation
4. **New Member Onboarding**: Use rules to train new developers

## Migration Strategies

### From Other AI Tools
1. **Import Existing Rules**: Use rulesync import to convert from other tools
2. **Simplify Format**: Remove complex frontmatter and keep Markdown content
3. **Reorganize Content**: Structure rules for Cline's simple approach
4. **Test Integration**: Verify rules work effectively with Cline

### From Manual Rules
1. **Audit Current Setup**: Review existing `.cline/instructions.md`
2. **Organize by Topic**: Break down into logical rule categories
3. **Convert to rulesync**: Import or recreate in `.rulesync/` format
4. **Generate New Config**: Use rulesync to create organized rule files

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check file locations and naming
2. **Inconsistent Behavior**: Review rule conflicts or contradictions
3. **Performance Issues**: Simplify overly complex rule files
4. **Content Clarity**: Ensure rules are specific and actionable

### Debugging Steps
1. **Check File Structure**: Verify correct directory organization
2. **Review Content**: Ensure rules are clear and specific
3. **Test Rule Application**: Verify AI follows established patterns
4. **Monitor Effectiveness**: Track how well rules guide development

## See Also

- [Configuration](../configuration.md) - Basic configuration options
- [Import Guide](../features/import.md) - Import existing configurations  
- [Best Practices](../guides/best-practices.md) - Rule organization strategies