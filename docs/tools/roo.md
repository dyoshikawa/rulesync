# Roo Code Integration

## Overview

Roo Code uses a simple, clean approach with plain Markdown rule files and a main instructions file. rulesync generates organized rule files that integrate seamlessly with Roo Code's instruction system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Main Instructions** | `.roo/instructions.md` | Primary instruction file (root rules) |
| **Rules** | `.roo/rules/*.md` | Individual rule files (non-root rules) |
| **MCP Configuration** | `.roo/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.rooignore` | File exclusion patterns |

## Rule Format

Roo Code uses clean, plain Markdown files with description headers:

```markdown
# TypeScript Development Standards

**Description**: Coding standards and best practices for TypeScript development

## Code Quality Guidelines
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Implement comprehensive error handling
- Write meaningful variable names

## Project Structure
- Organize code by feature, not by type
- Use barrel exports for clean imports
- Maintain consistent file naming conventions
- Follow single responsibility principle
```

## Rule Processing

### Root Rules
- **Target**: Main `.roo/instructions.md` file
- **Content**: Project overview and high-level guidelines
- **Format**: Plain Markdown with description header

### Non-Root Rules
- **Target**: Individual files in `.roo/rules/` directory
- **Content**: Specific implementation rules and detailed guidelines
- **Organization**: One file per rule category
- **Format**: Description header followed by rule content

## Usage Examples

### Generate Roo Code Configuration

```bash
# Generate only for Roo Code
npx rulesync generate --roo

# Generate with verbose output
npx rulesync generate --roo --verbose

# Generate in specific directory
npx rulesync generate --roo --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Roo Code setup
npx rulesync import --roo

# This imports from:
# - .roo/instructions.md (main instructions)
# - .roo/rules/*.md (individual rules)
```

## File Organization

### Standard Structure
```
.roo/
├── instructions.md              # Main instructions (root rules)
├── rules/
│   ├── typescript-standards.md # Language-specific rules
│   ├── testing-guidelines.md   # Testing requirements
│   ├── security-rules.md       # Security guidelines
│   ├── api-patterns.md         # API development patterns
│   └── deployment-process.md   # Deployment procedures
├── mcp.json                     # MCP server configuration
└── .rooignore                   # File exclusion patterns
```

### Content Examples

**Main Instructions** (`.roo/instructions.md`):
```markdown
# Project Development Guidelines

**Description**: Core development principles and project overview for the e-commerce platform

## Project Overview
This is a modern e-commerce platform built with React, TypeScript, and Node.js, focusing on scalability and maintainability.

## Tech Stack
- Frontend: React 18 with TypeScript
- Backend: Node.js with Express
- Database: PostgreSQL with Prisma ORM
- Styling: Tailwind CSS
- Testing: Jest and Cypress

## Development Philosophy
- Clean code and SOLID principles
- Test-driven development approach
- Security-first implementation
- Performance optimization focus

## Team Collaboration
- Code reviews for all changes
- Consistent formatting with Prettier
- Semantic versioning for releases
- Documentation-driven development
```

**Rule File** (`.roo/rules/typescript-standards.md`):
```markdown
# TypeScript Coding Standards

**Description**: Comprehensive TypeScript development guidelines and best practices

## Type Safety
- Enable strict mode in tsconfig.json
- Avoid using `any` type - use `unknown` if necessary
- Define explicit return types for functions
- Use type guards for runtime type checking

## Code Organization
- Use interfaces for object shapes
- Prefer union types over enums for simple cases
- Implement barrel exports for clean module imports
- Follow consistent naming conventions (PascalCase for types/interfaces)

## Error Handling
- Use Result/Either pattern for error handling
- Implement custom error types with proper inheritance
- Always handle promise rejections
- Use type-safe error boundaries in React
```

## Integration Benefits

### Developer Experience
- **Clean Interface**: Simple Markdown format without complex configuration
- **Readable Rules**: Clear, structured rule presentation
- **Quick Updates**: Easy rule modification and maintenance
- **Version Control**: Rules integrate naturally with Git workflow

### AI Assistant Enhancement
- **Clear Context**: Well-structured rules provide unambiguous guidance
- **Focused Assistance**: Rules help AI understand project-specific patterns
- **Consistent Output**: AI generates code following established standards
- **Reduced Ambiguity**: Description headers provide clear rule purposes

## Rule Examples

### Security Guidelines
```markdown
# Security Implementation Standards

**Description**: Security requirements and best practices for application development

## Authentication & Authorization
- Use JWT tokens with appropriate expiration times
- Implement role-based access control (RBAC)
- Hash passwords using bcrypt with minimum 12 rounds
- Validate all authentication tokens on server side

## Data Protection
- Never store sensitive data in localStorage
- Use HTTPS for all API communications
- Implement proper CORS policies
- Sanitize all user inputs before processing

## API Security
- Rate limit all public endpoints
- Implement proper input validation
- Use parameterized queries to prevent SQL injection
- Log security events for monitoring
```

### Testing Standards
```markdown
# Testing Guidelines and Requirements

**Description**: Comprehensive testing strategy and implementation standards

## Unit Testing
- Test all business logic functions
- Use descriptive test names following "should_when_given" pattern
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies and services

## Integration Testing
- Test API endpoints with real database
- Validate complete user workflows
- Test error scenarios and edge cases
- Use test databases separate from development

## Test Coverage
- Maintain minimum 80% code coverage
- Focus on critical business logic paths
- Include performance testing for key features
- Implement automated testing in CI/CD pipeline
```

### API Development Patterns
```markdown
# API Development Standards

**Description**: RESTful API design patterns and implementation guidelines

## Endpoint Design
- Use consistent RESTful URL patterns
- Implement proper HTTP status codes
- Follow consistent response format structure
- Use appropriate HTTP methods (GET, POST, PUT, DELETE)

## Data Validation
- Validate all input parameters
- Use schema validation libraries (e.g., Joi, Yup)
- Implement consistent error response format
- Sanitize data before database operations

## Performance Optimization
- Implement response caching where appropriate
- Use database indexing for frequently queried fields
- Implement pagination for large data sets
- Monitor API response times and optimize slow queries
```

## Best Practices

### Rule Organization
1. **Single Responsibility**: Each rule file covers one specific topic
2. **Clear Descriptions**: Use descriptive headers that explain rule purpose
3. **Logical Structure**: Organize rules hierarchically with clear headings
4. **Regular Maintenance**: Update rules as project and practices evolve

### Content Guidelines
1. **Actionable Content**: Provide specific, implementable guidelines
2. **Concrete Examples**: Include code examples where helpful
3. **Consistent Format**: Maintain similar structure across rule files
4. **Relevant Scope**: Keep rules focused on specific development contexts

### Team Collaboration
1. **Shared Understanding**: Ensure all team members understand rule purposes
2. **Regular Reviews**: Update rules based on team feedback and experience
3. **Documentation Sync**: Keep rules aligned with project documentation
4. **New Member Training**: Use rules for developer onboarding

## Advanced Features

### Context-Specific Rules

While Roo Code doesn't support conditional application, rules can be organized by context:

```markdown
# Frontend Component Development

**Description**: React component development patterns and standards

These guidelines apply when developing React components:

## Component Architecture
- Use functional components with hooks
- Implement proper TypeScript interfaces for props
- Follow atomic design principles
- Include accessibility attributes (ARIA)
```

### Environment-Specific Guidelines
```markdown
# Environment Configuration Standards

**Description**: Configuration management across development environments

## Development Environment
- Use local development servers
- Enable detailed error logging
- Allow development-only features
- Use development database instances

## Production Environment
- Use production-optimized builds
- Implement minimal logging for performance
- Enable security headers
- Use production database with proper backups
```

## Migration Strategies

### From Manual Setup
1. **Audit Current Rules**: Review existing `.roo/instructions.md` and rule files
2. **Organize by Topic**: Structure rules into logical categories
3. **Add Descriptions**: Ensure all rules have clear description headers
4. **Convert to rulesync**: Import or recreate in `.rulesync/` format

### From Other AI Tools
1. **Import Existing Rules**: Use rulesync import to convert from other tools
2. **Simplify Format**: Convert to clean Markdown with description headers
3. **Reorganize Content**: Structure rules for Roo Code's simple approach
4. **Test Integration**: Verify rules work effectively with Roo Code

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check file locations and description header format
2. **Inconsistent Behavior**: Review rule conflicts or contradictions
3. **Performance Issues**: Simplify overly complex rule files
4. **Content Clarity**: Ensure rules are specific and actionable

### Debugging Steps
1. **Check File Structure**: Verify correct directory organization and naming
2. **Review Content Format**: Ensure description headers are properly formatted
3. **Test Rule Effectiveness**: Verify AI follows established patterns
4. **Monitor Usage**: Track how well rules guide development practices

## Integration Benefits

### Development Workflow
- **Clear Guidance**: Description headers provide immediate rule context
- **Focused Rules**: Organized rule files target specific development areas
- **Easy Maintenance**: Simple format makes rule updates straightforward
- **Team Consistency**: Shared rules ensure consistent development practices

### AI Enhancement
- **Context Clarity**: Description headers help AI understand rule purposes
- **Targeted Application**: Rules apply to appropriate development contexts
- **Reduced Ambiguity**: Clear rule structure prevents misinterpretation
- **Consistent Results**: AI generates code following established patterns

## See Also

- [Configuration](../configuration.md) - Basic configuration options
- [Import Guide](../features/import.md) - Import existing configurations
- [Best Practices](../guides/best-practices.md) - Rule organization strategies