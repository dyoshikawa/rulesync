---
root: false
targets: ["*"]
description: "Windsurf rules or memories specification for configuration file generation"
globs: ["**/*.ts", "**/*.js", "**/*.md"]
---

# Windsurf Rules and Memories Specification

## Overview
Windsurf is an AI-powered IDE that uses a system called "Cascade" as its AI coding assistant. Windsurf provides two main mechanisms for context management:

1. **Memories**: Automatically or manually saved snippets of context that Cascade can recall later, scoped to the current workspace
2. **Rules**: User-authored instructions that tell Cascade how to behave, can be global (all workspaces) or local (project-specific)

## File Placement and Locations

### Global Rules (Machine-wide)
- **Location**: `~/.windsurf/global_rules.md`
- **Scope**: Applied automatically in every workspace
- **Use case**: Personal coding preferences and standards

### Workspace Rules (Project-specific)

#### Current Approach (Wave 8+)
- **Location**: `.windsurf/rules/` directory in project root
- **Format**: Multiple `*.md` files with descriptive names
- **Examples**:
  - `.windsurf/rules/frontend_guidelines.md`
  - `.windsurf/rules/security_review.md`
  - `.windsurf/rules/testing_standards.md`

#### Legacy Approach (Pre-Wave 8)
- **Location**: `.windsurfrules` file in project root
- **Format**: Simple numbered list format
- **Status**: Deprecated in favor of Markdown files

### Search Path and Discovery
Windsurf searches for rules using the following hierarchy:
1. Current workspace directory
2. All subdirectories within the workspace
3. Parent directories up to the Git repository root
4. Duplicates are automatically deduplicated

### Auxiliary Directories
- `.windsurf/task-logs/`: Rolling JSON logs of agent actions (audit/cleanup)
- `.windsurf/local-index/`: On-disk semantic index for codebase reasoning (auto-generated)

## File Format and Structure

### Current Format (Markdown)
Rules are written in plain Markdown format with no special frontmatter required.

#### Basic Structure
```markdown
# Rule Title (activation: always_on)

## Description
Brief description of what this rule does

## Guidelines
- Use bullet points for clarity
- Keep instructions specific and actionable
- Avoid generic advice

## Code Examples
```language
// Example code here
```

## XML Grouping (Optional)
<css_rules>
  - Prefer tailwind classes over inline styles
  - Do NOT use !important
</css_rules>
```

#### Advanced Features
- **XML Tags**: Optional grouping mechanism for related rules
- **Activation Mode**: Specified in rule title or through UI
- **Code Examples**: Embedded code blocks for reference
- **Structured Lists**: Bullet points and numbered lists preferred over prose

### Legacy Format (Deprecated)
```
1. My build system is Bazel
2. My testing framework is pytest
3. Don't modify any files in /protected/directory
4. Don't use these APIs: deprecated_api, old_function
```

## Rule Activation Modes

### 1. Manual Activation
- **Trigger**: Only when rule is @-mentioned in Cascade chat
- **Use case**: Specialized rules for specific situations
- **Example**: `@security_review` to apply security-focused rules

### 2. Always On
- **Behavior**: Automatically injected into every request
- **Use case**: Core coding standards and preferences
- **Caution**: Can increase token usage significantly

### 3. Model Decision
- **Behavior**: AI model decides whether rule is relevant based on natural language description
- **Use case**: Context-sensitive rules that should apply conditionally
- **Benefit**: Automatic relevance detection

### 4. Glob Pattern Matching
- **Behavior**: Auto-applied when edited file matches specified patterns
- **Syntax**: Uses glob patterns like `src/**/*.ts`, `**/*.jsx`
- **Use case**: File-type or directory-specific rules
- **Examples**:
  - `*.test.js` - Apply testing rules to test files
  - `src/components/**/*.tsx` - React component guidelines
  - `docs/**/*.md` - Documentation standards

## Configuration Management

### Creating Rules via UI
1. **Cascade Panel**: 
   - Open Cascade panel
   - Click "Customizations" (triple-dot menu)
   - Select "Rules" → "+ Global" or "+ Workspace"

2. **Windsurf Settings**:
   - Click gear icon (bottom-right)
   - Navigate to "Rules" tab
   - Create new rule

### Direct File Editing
- Edit Markdown files directly in `.windsurf/rules/` directory
- Changes are automatically detected and applied
- Recommended for version control and team collaboration

## Content Guidelines and Best Practices

### Effective Rule Writing

#### Do's
- Keep rules **specific and actionable**
- Use **clear formatting** (bullet points, numbered lists)
- Include **concrete code examples**
- Focus on **project-specific conventions**
- Group related rules with **XML tags** if needed
- Write **descriptive rule titles**

#### Don'ts
- Avoid generic advice ("write clean code", "follow best practices")
- Don't write long paragraphs - use structured lists
- Avoid contradictory or conflicting rules
- Don't duplicate information already in Cascade's training

### Content Structure Examples

#### Frontend Guidelines
```markdown
# Frontend Guidelines (activation: always_on)

## Framework Standards
- Use Next.js 14 folder conventions
- Prefer App Router over Pages Router
- Use TypeScript for all new components

## UI Components
- Use shadcn-ui components where possible
- Follow atomic design principles
- Implement responsive design with Tailwind CSS

## Code Examples
```tsx
// Preferred component structure
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
```

<styling_rules>
  - Prefer tailwind classes over inline styles
  - Use semantic color names (primary, secondary)
  - Do NOT use !important declarations
</styling_rules>
```

#### Testing Standards
```markdown
# Testing Standards (activation: glob:src/**/*.test.ts)

## Testing Framework
- Use vitest + @testing-library/react for React components
- Use Jest for Node.js backend code
- Prefer integration tests over unit tests

## Test Structure
- Use describe/it pattern
- Write descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

## Coverage Requirements
- Minimum 80% code coverage
- 100% coverage for critical business logic
- Test error scenarios and edge cases
```

#### Security Guidelines
```markdown
# Security Review (activation: manual)

## Authentication
- Always validate JWT tokens
- Implement proper session management
- Use HTTPS in production

## Data Validation
- Sanitize all user inputs
- Use parameterized queries for database access
- Implement rate limiting on APIs

## Sensitive Data
- Never log sensitive information
- Use environment variables for secrets
- Implement proper error handling
```

## Size Limitations and Constraints

### File Size Limits
- **Individual rule file**: Maximum 12,000 characters
- **Total combined rules**: Cannot exceed 12,000 characters across all files
- **Recommended size**: Keep individual rules under 6,000 characters for better performance

### Memory System
- **Memories**: No size limit mentioned, stored in internal database
- **Memory operations**: Do not consume credits
- **Scope**: Workspace-specific, don't follow between projects

## Integration Features

### Version Control Integration
- **Recommended**: Commit `.windsurf/rules/` directory to Git
- **Team sharing**: Rules are shared across team members
- **Best practice**: Include rule changes in pull request reviews

### Memory Management
#### Creating Memories
```
"create a memory of Our staging URL is https://stg.acme.com"
```

#### Managing Memories
```
"list my memories"
"delete the memory about staging URL"
```

#### Memory Export
- Available through Settings panel
- Useful for backups and migration

### IDE Integration
- **GUI Editor**: Visual interface for rule creation and editing
- **Syntax Highlighting**: Markdown syntax support
- **Auto-detection**: Automatic rule file discovery
- **Live Updates**: Changes applied immediately without restart

## Rule Examples by Technology

### Python Projects
```markdown
# Python Standards (activation: glob:**/*.py)

## Code Style
- Follow PEP 8 guidelines
- Use Black for code formatting
- Maximum line length: 88 characters

## Dependencies
- Use poetry for dependency management
- Pin versions in pyproject.toml
- Keep dependencies minimal

## Testing
- Use pytest for all tests
- Follow naming convention: test_*.py
- Use fixtures for test data setup
```

### Node.js Projects
```markdown
# Node.js Guidelines (activation: glob:**/*.js,**/*.ts)

## Package Management
- Use npm/yarn for dependencies
- Keep package.json clean and organized
- Use exact versions for production dependencies

## Code Organization
- Use ES6+ features
- Prefer async/await over promises
- Implement proper error handling with try/catch
```

### React Projects
```markdown
# React Best Practices (activation: glob:**/*.jsx,**/*.tsx)

## Component Structure
- Use functional components with hooks
- Implement proper prop types or TypeScript interfaces
- Keep components small and focused

## State Management
- Use useState for local state
- Use useContext for shared state
- Consider Redux for complex state logic
```

## Advanced Configuration

### Multi-Environment Rules
```markdown
# Environment-Specific Rules (activation: model_decision)

## Development Environment
- Enable debug logging
- Use development API endpoints
- Allow console.log statements

## Production Environment
- Disable all debug output
- Use production API endpoints
- Implement proper error tracking
```

### Team Collaboration Rules
```markdown
# Team Collaboration (activation: always_on)

## Code Review Process
- All changes require PR review
- Minimum 2 approvals for critical changes
- Run CI/CD pipeline before merging

## Documentation
- Update README for API changes
- Document complex business logic
- Keep changelog updated
```

## Best Practices for Rule Management

### Organization Strategy
1. **Separate files by domain**: frontend, backend, testing, security
2. **Use descriptive filenames**: `react_components.md`, `api_standards.md`
3. **Keep rules focused**: One domain per file
4. **Regular maintenance**: Review and update rules quarterly

### Team Workflow
1. **Establish rule ownership**: Assign maintainers for different rule categories
2. **Review process**: Include rule changes in code reviews
3. **Documentation**: Maintain a rule directory or index
4. **Training**: Onboard new team members on existing rules

### Performance Considerations
1. **Selective activation**: Use glob patterns instead of "always on" when possible
2. **Rule pruning**: Remove outdated or conflicting rules
3. **Size management**: Keep rules concise and focused
4. **Testing**: Verify rule effectiveness and adjust as needed

## Troubleshooting

### Common Issues
1. **Rules not applying**: Check file location and syntax
2. **Performance issues**: Reduce rule size or change activation mode
3. **Conflicting rules**: Review for contradictory instructions
4. **Overly verbose output**: Make rules more specific and concise

### Debugging Tips
1. **Check rule discovery**: Verify files are in correct locations
2. **Test activation modes**: Experiment with different activation methods
3. **Monitor token usage**: Track impact of "always on" rules
4. **Review logs**: Check task logs for rule application patterns

## Migration Guide

### From Legacy .windsurfrules
1. Create `.windsurf/rules/` directory
2. Convert numbered list to Markdown format
3. Split into logical rule files
4. Add appropriate activation modes
5. Test rule application

### From Other AI Tools
- **Cursor .cursorrules**: Convert to Windsurf Markdown format
- **VS Code settings**: Extract relevant preferences to rules
- **Custom prompts**: Restructure as Windsurf rules with appropriate activation

This specification provides comprehensive guidance for implementing Windsurf rules and memories configuration in rulesync, enabling effective AI-assisted development workflows.