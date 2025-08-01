---
root: false
targets: ["*"]
description: "JetBrains Junie AI coding assistant guidelines and rules configuration specification"
globs: []
---

# JetBrains Junie Guidelines and Rules Configuration Specification

## Overview
JetBrains Junie is an autonomous AI coding agent integrated into JetBrains IDEs. It uses project-level configuration files to understand project context, coding standards, and operational constraints.

## File Placement and Structure

### 1. .junie/guidelines.md (Primary Configuration)
- **Location**: `.junie/guidelines.md` in project root
- **Purpose**: The "brain" of Junie - persistent, version-controlled context read on every task
- **Visibility**: Committed to version control for team consistency

### Hidden Directory Structure
```
<project-root>/
└── .junie/
    └── guidelines.md    # Main configuration file
```

## File Format

### Basic Structure
The guidelines file uses plain Markdown format with no special frontmatter or YAML headers required.

```markdown
# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Tailwind CSS
- Testing: Jest + React Testing Library

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types for object shapes
3. Use meaningful variable names
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services

## Code Examples
```typescript
// Preferred component structure
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
```

```

## Content Structure Recommendations

### Essential Sections
1. **Tech Stack**: Framework versions, core libraries, architecture choices
2. **Coding Standards**: Style rules, naming conventions, quality requirements
3. **Testing Strategy**: Testing frameworks, coverage requirements, test patterns
4. **Code Examples**: Preferred patterns and implementations
5. **Antipatterns**: What to avoid, deprecated practices
6. **Build & Deployment**: Commands, processes, environments

### Advanced Sections
- **Security Guidelines**: Security requirements, sensitive data handling
- **Performance Considerations**: Optimization guidelines, performance budgets
- **Documentation Standards**: Comment styles, README requirements
- **Git Workflow**: Branch naming, commit message format, PR guidelines
- **Dependencies**: Approved libraries, version management policies

## Creation Methods

### 1. Manual Creation
- Use "Create project guidelines" from the IDE prompt panel
- Create the `.junie/` directory and `guidelines.md` file manually
- Copy content from team templates or existing projects

### 2. Auto-generation
Ask Junie to explore and create guidelines:
```
"Explore the project and create guidelines"
```

**Process**:
1. Junie scans the project for 30-90 seconds
2. Runs harmless shell commands (ls, find, etc.) to understand structure
3. Analyzes code patterns, dependencies, and configuration files
4. Generates comprehensive guidelines file for review and editing

### 3. Template Library
- Use snippets from JetBrains' open-source guidelines catalog
- Repository: [JetBrains/junie-guidelines](https://github.com/JetBrains/junie-guidelines)
- Copy and adapt relevant sections for your project

## Operating Modes and Rule Application

### Ask Mode
- **Behavior**: Chat-style Q&A interaction
- **Guidelines Usage**: Always injected into context
- **File Access**: Respects .aiignore restrictions
- **Safety**: Manual approval for sensitive operations

### Code Mode
- **Behavior**: Autonomous multi-step execution
- **Guidelines Usage**: Continuously referenced during execution
- **Permission Flow**:
  1. **Brave Mode ON** → Full trust, no confirmations
  2. **Command in Allowlist** → Auto-run without confirmation
  3. **Default** → Explicit confirmation dialog

## Integration with IDE Settings

### IDE-Level Configuration
Access via: **Settings | Tools | Junie | Project Settings**

#### Writable Area Restriction
- Scope Junie's write access to specific subdirectories
- Files outside the writable area require explicit approval
- Useful for protecting critical configuration or production code

#### Action Allowlist
- **Path**: Settings | Tools | Junie | Action Allowlist
- **Purpose**: White-list CLI commands using regular expressions
- **Effect**: Matching commands run unattended even without Brave Mode

**Example Patterns**:
```regex
# Allow all npm scripts
^npm run \w+$

# Allow Laravel artisan commands
^\Qphp artisan \E\S+(?:\s+(?:[-\w:=]+|"[^"]*"|'[^']*'))*$

# Allow git status and log commands
^git (status|log).*$

# Allow test runners
^(npm test|yarn test|pnpm test)$
```

### Brave Mode
- **Location**: Checkbox in Code mode toolbar
- **Effect**: Junie can run any terminal command and access any file without confirmation
- **Use Case**: Development sandboxes, experimental branches
- **Caution**: Use only in controlled environments

## Best Practices

### Content Guidelines
1. **Keep it concise**: Focus on essential project-specific information
2. **Be specific**: Provide concrete examples rather than vague principles
3. **Include examples**: Show preferred code patterns and structures
4. **Version control**: Commit guidelines to share with team members
5. **Regular updates**: Keep guidelines current with project evolution

### Security Considerations
1. **No secrets**: Never include API keys, passwords, or sensitive data
2. **Safe commands**: Only allowlist idempotent, safe CLI commands
3. **Review changes**: Carefully review Junie's first commits and PRs
4. **Gradual trust**: Start with restrictive settings, gradually relax as confidence builds

### Team Workflow
1. **Early creation**: Establish guidelines.md early in project lifecycle
2. **Team review**: Have team members review and approve initial guidelines
3. **Consistent format**: Use standardized template across projects
4. **Regular maintenance**: Update guidelines as project evolves
5. **Documentation**: Document custom allowlist patterns and their purposes

### Content Organization
```markdown
# Project Guidelines

## Quick Reference
- Primary language: TypeScript
- Framework: Next.js 14
- Package manager: pnpm

## Development Workflow
### Setup Commands
```bash
pnpm install
pnpm dev
```

### Testing
```bash
pnpm test
pnpm test:watch
```

### Build
```bash
pnpm build
pnpm start
```

## Coding Standards
### File Organization
- Components: `src/components/`
- Pages: `src/pages/`
- Utils: `src/lib/`
- Types: `src/types/`

### Naming Conventions
- Components: PascalCase (`UserProfile.tsx`)
- Files: kebab-case (`user-profile.utils.ts`)
- Variables: camelCase (`userName`)
- Constants: UPPER_SNAKE_CASE (`API_BASE_URL`)

### Code Style
1. Use TypeScript strict mode
2. Prefer named exports over default exports
3. Use explicit return types for functions
4. Write descriptive variable names

## Architecture
### State Management
- Use React hooks for local state
- Use Zustand for global state
- Avoid prop drilling beyond 2 levels

### API Integration
- Use React Query for data fetching
- Implement proper error boundaries
- Handle loading states consistently

## Testing Requirements
- Unit tests for all business logic
- Integration tests for API endpoints
- Component tests for complex UI logic
- Minimum 80% code coverage
```

## Maintenance and Updates

### Regular Review Points
1. **After major refactoring**: Update patterns and examples
2. **New team members**: Review guidelines for clarity and completeness
3. **Technology updates**: Reflect framework/library version changes
4. **Process changes**: Update workflow and command examples

### Monitoring Effectiveness
- Review Junie's code generation quality
- Track adherence to established patterns
- Collect team feedback on guideline clarity
- Measure reduction in review comments

## Integration with Other Tools

### Version Control
- Commit `.junie/guidelines.md` to repository
- Include in PR reviews when guidelines change
- Use semantic versioning for major guideline updates

### CI/CD Integration
- Reference guidelines in PR templates
- Automate guideline compliance checks
- Include guideline validation in CI pipeline

### Documentation Systems
- Link to external documentation where appropriate
- Keep internal guidelines focused on Junie-specific needs
- Avoid duplicating information available in README or docs

## Troubleshooting

### Common Issues
1. **Guidelines not applied**: Check file location and syntax
2. **Overly verbose output**: Reduce guideline length, increase specificity
3. **Inconsistent behavior**: Review conflicting rules or unclear instructions
4. **Performance issues**: Large guidelines files can slow context loading

### Optimization Tips
- Keep guidelines under 2000 words
- Use bullet points and numbered lists for clarity
- Include specific code examples rather than abstract principles
- Remove outdated or conflicting information regularly