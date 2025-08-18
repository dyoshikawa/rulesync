---
root: false
targets: ["*"]
description: "Amazon Q Developer CLI rules and context configuration specification"
globs: []
---

# Amazon Q Developer CLI Rules and Context Configuration Specification

## Overview
Amazon Q Developer CLI uses a context management system to provide persistent project-specific context and rules through Markdown files stored in the `.amazonq/rules/` directory. This system enhances AI-assisted development by providing relevant context and coding standards.

## File Placement and Structure

### Primary Configuration Location
- **Directory**: `.amazonq/rules/`
- **Location**: Project root directory
- **File Format**: Markdown files (`.md` extension)
- **Scope**: Project-specific context and rules
- **Version Control**: Should be committed to repository for team consistency

### File Discovery
- Amazon Q automatically discovers all Markdown files in `.amazonq/rules/`
- Files are processed recursively if subdirectories exist
- Rules are applied automatically in chat sessions within the project

## Configuration Methods

### Agent Configuration (Recommended)
Define persistent context in agent configuration files using resource patterns:

```json
{
   "name": "my-agent",
   "resources": [
     "file://README.md",
     "file://.amazonq/rules/**/*.md",
     "file://docs/**/*.md",
     "file://src/config.py"
   ]
}
```

### Session Context (Temporary)
Add temporary context during chat sessions using slash commands:
- `/context add --global .amazonq/rules/security-standards.md`
- `/context show` - View current context
- `/context rm` - Remove specific context files
- `/context clear` - Remove all session context

## File Format and Content Structure

### Basic Markdown Format
- **Format**: Plain Markdown (`.md`)
- **Encoding**: UTF-8
- **Structure**: No special frontmatter required
- **Size**: No specific limits mentioned in documentation

### Recommended Content Structure
```markdown
# Project Rules

## Technology Stack
- Language: TypeScript
- Framework: React 18
- Package Manager: npm

## Coding Standards
- Use functional components with hooks
- Prefer TypeScript strict mode
- Follow ESLint configuration
- Write comprehensive tests

## Security Requirements
- All Amazon S3 buckets must have encryption enabled
- Enforce SSL for all services
- Block public access by default
- All DynamoDB tables must have encryption enabled

## Architecture Guidelines
- Follow clean architecture principles
- Separate business logic from UI components
- Use dependency injection for services
- Implement proper error handling
```

## Context Management Commands

### Core Commands
- **`/context add`**: Add temporary context files
- **`/context show`**: View current context configuration
- **`/context rm`**: Remove specific context files
- **`/context clear`**: Remove all session context

### Profile Management
- **`/profile`**: Manage Q Developer profiles
- Profiles allow switching between different context sets
- Enable unique interaction patterns for different projects

## Rule Categories

### Development Rules
Define coding standards, frameworks, and development practices:
```markdown
## Development Standards
- Use semantic versioning
- Follow conventional commit messages
- Write unit tests for all business logic
- Document public APIs with JSDoc
```

### Security Rules
Specify security requirements and best practices:
```markdown
## Security Requirements
- Never commit API keys or secrets
- Use environment variables for configuration
- Validate all user inputs
- Implement proper authentication
```

### Project-Specific Rules
Include project-specific guidelines and constraints:
```markdown
## Project Guidelines
- Follow company branding guidelines
- Use approved third-party libraries only
- Implement accessibility standards (WCAG 2.1)
- Maintain 80% test coverage minimum
```

## Integration with Other Features

### Custom Agents
Rules integrate with custom agent configurations to provide:
- Persistent context across sessions
- Tool access control
- Permission management
- Resource allocation

### MCP Integration
Context files work alongside MCP (Model Context Protocol) servers:
- Rules provide project context
- MCP servers provide external tool access
- Combined for comprehensive development assistance

## Best Practices

### File Organization
1. **Logical Separation**: Use separate files for different rule categories
2. **Clear Naming**: Use descriptive filenames (`security-rules.md`, `coding-standards.md`)
3. **Hierarchical Structure**: Organize rules from general to specific
4. **Regular Updates**: Keep rules current with project evolution

### Content Guidelines
1. **Be Specific**: Include concrete examples and patterns
2. **Use Examples**: Show preferred code structures
3. **Security First**: Emphasize security practices
4. **Keep Current**: Regular updates as project evolves

### Team Collaboration
1. **Version Control**: Commit `.amazonq/rules/` to repository
2. **Documentation**: Document rule purposes and exceptions
3. **Team Review**: Include rule changes in code reviews
4. **Consistent Format**: Use standardized rule templates

## Migration and Import

### From Other AI Tools
Amazon Q can work alongside other AI development tools:
- Import existing rules from other tools
- Convert rule formats to Amazon Q context files
- Maintain consistency across multiple AI assistants

### Legacy Projects
For projects with existing documentation:
- Convert existing README files to context files
- Extract coding standards from existing documentation
- Preserve institutional knowledge in rule files

## Advanced Features

### Global vs Project Context
- **Global Context**: Rules that apply across all projects
- **Project Context**: Rules specific to current project
- **Precedence**: Project context takes precedence over global

### Dynamic Context
- Context can be modified during chat sessions
- Temporary context for specific tasks or features
- Context persistence across sessions with conversation resume

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check file location and format
2. **Context Not Loading**: Verify agent configuration
3. **Conflicting Rules**: Review rule hierarchy and precedence

### Debugging Commands
- Use `/context show` to verify loaded context
- Check agent configuration for resource patterns
- Validate Markdown syntax in rule files

## Security Considerations

### Best Practices
1. **No Secrets**: Never include API keys or passwords in rule files
2. **Public Repository**: Assume rule files are public
3. **Team Access**: Ensure all team members can access rule files
4. **Regular Audits**: Review rules for sensitive information

## Summary

Amazon Q Developer CLI's context and rules system provides:
- **Project-Specific Context**: Tailored assistance based on project requirements
- **Persistent Rules**: Consistent application of coding standards
- **Team Collaboration**: Shared knowledge base across team members
- **Flexible Configuration**: Both permanent and temporary context management
- **Integration**: Seamless work with MCP servers and custom agents

The system enables effective AI-assisted development by providing relevant context and maintaining consistency across development workflows.