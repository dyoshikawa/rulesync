---
root: false
targets: ["*"]
description: "Agents.md standardized markdown file format for providing coding agents with project-specific instructions and context"
globs: []
---

# Agents.md Rules and Instructions Specification

## Overview
AGENTS.md is an open-source, standardized markdown file format designed to provide coding agents with project-specific instructions and context. It serves as a "README for agents" - a dedicated, predictable place to provide context and instructions to help AI coding agents work effectively on your project.

## File Placement and Structure

### Primary File Location
- **File**: `AGENTS.md`
- **Location**: Repository root directory
- **Format**: Standard Markdown (`.md`)
- **Case Sensitivity**: Uppercase filename is recommended
- **Version Control**: Should be committed to repository for team consistency

### Hierarchical Support
- **Monorepo Support**: Can include nested `AGENTS.md` files in subprojects
- **Precedence Rule**: Closest `AGENTS.md` file takes precedence in multi-directory projects
- **Scope**: Each file applies to its directory and subdirectories unless overridden

### File Discovery
```
repository-root/
├── AGENTS.md              # Root-level instructions
├── backend/
│   └── AGENTS.md          # Backend-specific instructions
├── frontend/
│   └── AGENTS.md          # Frontend-specific instructions
└── docs/
    └── AGENTS.md          # Documentation-specific instructions
```

## File Format and Structure

### Basic Requirements
- **Format**: Standard Markdown format
- **Encoding**: UTF-8
- **Required Fields**: None - completely flexible structure
- **Structure**: Project-specific based on needs
- **Size**: No specific limits mentioned

### Recommended Content Structure
```markdown
# Project Instructions for AI Agents

## Project Overview
Brief description of the project, its purpose, and key technologies used.

## Development Environment
Instructions for setting up the development environment.

## Build and Test Commands
Specific commands for building and testing the project.

## Code Style Guidelines
Coding standards, formatting rules, and best practices.

## Testing Instructions
How to run tests, test structure, and testing requirements.

## Security Considerations
Security guidelines and sensitive areas to be aware of.

## Deployment
Deployment procedures and environment-specific instructions.
```

## Supported AI Coding Agents

### Compatible Tools
AGENTS.md is designed to be compatible with multiple AI coding agents:
- **OpenAI Codex**
- **Cursor**
- **Jules**
- **Other AI coding agents** that can read markdown files

### Agent Integration
- Agents automatically discover and read AGENTS.md files
- Agents can execute testing commands listed in the file
- Instructions are used to provide context for code generation and modifications

## Content Guidelines

### Essential Sections

#### 1. Project Overview
```markdown
## Project Overview
This is a [technology] project that [purpose/description].
Key technologies: [list of main technologies]
```

#### 2. Build and Test Commands
```markdown
## Build and Test Commands
```bash
# Install dependencies
npm install

# Run tests
npm test

# Build project
npm run build

# Start development server
npm run dev
```

#### 3. Code Style Guidelines
```markdown
## Code Style
- Use TypeScript strict mode
- Follow ESLint configuration
- Use Prettier for formatting
- Prefer functional components in React
```

#### 4. Testing Instructions
```markdown
## Testing
- Write unit tests for all business logic
- Use Jest and React Testing Library
- Maintain minimum 80% code coverage
- Run tests before committing
```

#### 5. Security Considerations
```markdown
## Security
- Never commit API keys or secrets
- Use environment variables for sensitive data
- Validate all user inputs
- Follow OWASP security guidelines
```

### Advanced Sections

#### Development Environment Tips
```markdown
## Development Environment
- Node.js version: 18+
- Use pnpm for package management
- Install recommended VS Code extensions
- Configure pre-commit hooks
```

#### Pull Request Guidelines
```markdown
## Pull Request Guidelines
- Create feature branches from main
- Write descriptive commit messages
- Include tests for new features
- Update documentation as needed
```

#### Architecture Patterns
```markdown
## Architecture
- Follow clean architecture principles
- Use dependency injection
- Separate business logic from UI
- Implement proper error handling
```

## Best Practices

### Content Organization
1. **Start with Overview**: Provide high-level project context first
2. **Practical Commands**: Include specific, actionable commands
3. **Clear Guidelines**: Use bullet points and numbered lists
4. **Code Examples**: Include relevant code snippets and patterns
5. **Keep Updated**: Regular updates as project evolves

### File Management
1. **Version Control**: Always commit AGENTS.md to repository
2. **Team Consistency**: Ensure all team members follow the guidelines
3. **Regular Review**: Update instructions based on project changes
4. **Specific Instructions**: Tailor content to your specific project needs

### Agent Optimization
1. **Clear Commands**: Provide explicit commands for common tasks
2. **Context Rich**: Include enough context for agents to understand the project
3. **Actionable**: Focus on what agents should do, not just what the project is
4. **Tool Specific**: Include tool-specific instructions when relevant

## Integration with Development Workflow

### Team Collaboration
- All team members should be familiar with AGENTS.md content
- Instructions should be accessible to both humans and AI agents
- Regular updates based on team feedback and project evolution

### CI/CD Integration
- Agents can reference build and test commands from AGENTS.md
- Deployment instructions can be standardized across environments
- Quality gates can be documented for automated systems

### Documentation Sync
- Keep AGENTS.md synchronized with README.md and other documentation
- Avoid duplication but provide agent-specific context
- Link to external documentation when appropriate

## File Examples

### Basic Example
```markdown
# AI Agent Instructions

## Project Overview
A Node.js REST API built with Express and TypeScript.

## Setup
```bash
npm install
npm run build
npm start
```

## Testing
```bash
npm test
npm run test:watch
```

## Code Style
- Use TypeScript strict mode
- Follow existing ESLint configuration
- Write tests for all new features
```

### Advanced Example
```markdown
# Project Instructions for AI Agents

## Project Overview
A full-stack e-commerce application with React frontend and Node.js backend.

## Tech Stack
- Frontend: React 18, TypeScript, Tailwind CSS
- Backend: Node.js, Express, PostgreSQL
- Testing: Jest, Cypress
- Deployment: Docker, AWS

## Development Commands
```bash
# Full setup
docker-compose up -d
npm install
npm run migrate

# Development
npm run dev:frontend
npm run dev:backend

# Testing
npm run test:unit
npm run test:e2e
```

## Code Guidelines
- Use functional components with hooks
- Implement proper error handling
- Follow REST API conventions
- Write comprehensive tests

## Security
- Never commit .env files
- Use parameterized queries
- Validate all inputs
- Implement proper authentication
```

## Troubleshooting

### Common Issues
1. **File Not Found**: Ensure AGENTS.md is in the repository root
2. **Inconsistent Instructions**: Regular review and updates needed
3. **Agent Confusion**: Provide clear, specific instructions
4. **Outdated Commands**: Keep build and test commands current

### Validation
- Test all commands listed in AGENTS.md
- Ensure instructions are clear and actionable
- Verify compatibility with target AI agents
- Regular review for accuracy and completeness

## Migration and Adoption

### From Other Tools
AGENTS.md can complement or replace other AI instruction files:
- Can work alongside existing README.md
- May replace tool-specific instruction files
- Provides standardized format across different AI agents

### Implementation Strategy
1. Start with basic project overview and commands
2. Add sections gradually based on project needs
3. Test with target AI coding agents
4. Iterate based on agent behavior and team feedback

## Summary

AGENTS.md provides a standardized way to give AI coding agents project-specific context and instructions. Key benefits include:

- **Predictable Location**: Always at repository root or closest parent
- **Flexible Structure**: No required fields, adapt to project needs
- **Multi-Agent Support**: Compatible with various AI coding tools
- **Team Consistency**: Shared instructions for both humans and AI
- **Easy Maintenance**: Standard markdown format with version control

The format emphasizes practical, actionable instructions that help AI agents understand and work effectively with your codebase.