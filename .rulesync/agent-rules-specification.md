# Agent-Rules Specification (AGENTS.md)

## Overview

Agent-Rules is an emerging community standard for defining AI coding agent behavior and interaction rules across multiple tools and platforms. It provides a standardized `AGENTS.md` file format that allows projects to specify consistent guidelines for AI agents regardless of which tool is being used.

## Background

- **Standardization Initiative**: Collaboration between OpenAI, Claude, and Google
- **Website**: https://agent-rules.org/
- **License**: Creative Commons Attribution 4.0 International License
- **Inspiration**: Similar to EditorConfig, Semantic Versioning, and Conventional Commits

## File Requirements

### Basic Requirements
- **Filename**: `AGENTS.md` (case-sensitive on POSIX systems)
- **Location**: Project root directory
- **Optional**: Additional `AGENTS.md` in current working directory
- **Format**: Markdown or plain text
- **Encoding**: UTF-8

### File Priority
Agents MUST check for `AGENTS.md` in the following order:
1. Project root directory
2. Current working directory (optional)
3. Only the first file found is used; others are ignored

## Content Specifications

### Format Guidelines
- **Structure**: Natural language in Markdown
- **Style**: Flat, unordered bullet list of rules (recommended)
- **Language**: Concise, imperative statements
- **Keywords**: Use "MUST", "SHOULD", "MAY" for clarity
- **Focus**: Project-specific guidance and behavioral expectations

### Content Categories
- Coding standards and conventions
- Security requirements
- Testing requirements
- Technology stack preferences
- Workflow and process guidelines
- Documentation standards

## Implementation Requirements

### For Agent Developers
Agents MUST:
- Check for `AGENTS.md` in project root
- Parse file as natural language instructions
- NOT require additional metadata or complex parsing
- Process file alongside other configuration files

Agents MAY:
- Process additional `AGENTS.md` in current working directory
- Combine with tool-specific configuration files

### For Content Authors
- Use clear, actionable statements
- Avoid complex structures or metadata
- Focus on project-specific guidance
- Keep rules concise and unambiguous

## Example Content Structure

```markdown
# Agent Rules

## Coding Standards
- MUST use TypeScript for all new JavaScript code
- MUST use functional components with hooks in React
- MUST include proper TypeScript interfaces for all props
- SHOULD write meaningful variable names in camelCase

## Security Requirements
- MUST never commit API keys or secrets to version control
- MUST use environment variables for configuration
- MUST validate all user inputs
- SHOULD implement proper error handling

## Testing Requirements
- MUST write unit tests for all business logic functions
- MUST achieve minimum 80% code coverage
- SHOULD include integration tests for API endpoints
- SHOULD use meaningful test descriptions

## Documentation
- MUST include JSDoc comments for all public functions
- MUST update README when adding new features
- SHOULD include usage examples in documentation

## Dependencies
- MUST use npm for package management
- SHOULD prefer well-maintained packages with active communities
- MUST document any custom build steps in README
```

## Supported Tools

The following AI coding tools currently support or are committed to supporting AGENTS.md:

### Confirmed Support
- **Aider**: Code review and editing tool
- **Amp**: Development assistant
- **Claude**: Using symbolic link (`ln -s AGENTS.md CLAUDE.md`)
- **Cline**: VS Code extension
- **Codex**: OpenAI's coding assistant
- **GitHub Copilot**: "if no copilot instructions exist will find an AGENTS.md if it exists"
- **Factory AI**: Autonomous coding platform
- **Firebase Studio**: Google's development environment
- **Google Jules**: Internal Google tool
- **Google Gemini CLI**: Command-line interface
- **OpenCode**: Open-source coding assistant
- **Phoenix Framework**: Elixir web framework tooling
- **Roo Code**: AI coding assistant

### Implementation Notes
- **GitHub Copilot**: Fallback mechanism when no `.github/copilot-instructions.md` exists
- **Claude**: Currently uses symbolic link approach for compatibility
- **Cross-tool compatibility**: Same file works across multiple tools

## Implementation Guidance

### For rulesync Integration

The rulesync tool should support AGENTS.md through:

1. **Generation**: Create AGENTS.md from unified rule files
2. **Parsing**: Read existing AGENTS.md files during import
3. **Validation**: Check AGENTS.md format and content
4. **Conversion**: Transform between AGENTS.md and tool-specific formats

### File Structure for rulesync
```
project-root/
├── AGENTS.md                 # Generated standard file
├── .rulesync/
│   └── rules/
│       ├── coding-standards.md
│       ├── security.md
│       └── testing.md
└── tool-specific-configs/    # Generated from AGENTS.md
    ├── .github/copilot-instructions.md
    ├── .claude/memory.md
    └── .cursor/rules.md
```

## Benefits

### For Projects
- **Tool Independence**: Same rules work across multiple AI tools
- **Reduced Duplication**: Single source of truth for agent behavior
- **Team Consistency**: Shared understanding of project conventions
- **Easy Migration**: Switch tools without rewriting rules

### For Tool Developers
- **Standardization**: Common format reduces implementation complexity
- **Interoperability**: Users can switch tools seamlessly
- **Community Adoption**: Benefit from shared ecosystem standards

### For Users
- **Simplified Setup**: One file to configure multiple tools
- **Consistent Behavior**: Same rules applied regardless of tool choice
- **Future-Proofing**: Investment in standards rather than vendor-specific formats

## Related Standards

- **EditorConfig**: Editor configuration standardization
- **Semantic Versioning**: Version number conventions
- **Conventional Commits**: Commit message format standards
- **Keep a Changelog**: Changelog format guidelines

## References

- **Specification Website**: https://agent-rules.org/
- **GitHub Issue**: https://github.com/dyoshikawa/rulesync/issues/99
- **Community Discussion**: Growing adoption across AI coding tools
- **License**: Creative Commons Attribution 4.0 International

## Future Considerations

- **Schema Evolution**: Potential for more structured formats
- **Validation Tools**: Community-developed linting and validation
- **Extended Metadata**: Optional structured data for complex scenarios
- **Integration Standards**: Guidelines for tool-specific extensions