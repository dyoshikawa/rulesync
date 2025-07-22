---
root: false
targets: ["*"]
description: "AugmentCode rules specification for configuration file generation"
globs: ["**/*.ts", "**/*.js", "**/*.md"]
---

# AugmentCode Rules Specification

## Overview
AugmentCode uses a rules system to provide project-specific instructions and context through structured Markdown files in the `.augment/` directory.

## File Placement

### Directory Structure
```text
.augment/                         # All Augment-specific artifacts
└── rules/                        # Instruction files (Markdown)
    ├── coding-standards-always.md
    ├── project-guidelines-manual.md
    └── onboarding-checklist-auto.md
```

### File Location
- **Primary location**: `.augment/rules/` directory in project root
- **File format**: Markdown (`.md`) or MDC (`.mdc`) files
- **Auto-discovery**: Files are automatically discovered, no build step required
- **Version control**: Should be committed to repository for team consistency

## File Format

### Frontmatter Schema
Each rule file must include YAML frontmatter with the following structure:

```yaml
---
type: always | manual | auto     # Required: Rule application type
description: "Brief description" # Required for auto rules, blank for always rules
tags: [tag1, tag2]              # Optional: Tags for organization
---
```

### Rule Types

#### 1. Always Rules (`type: always`)
- **Behavior**: Injected into every request automatically
- **Usage**: Organization-wide conventions and critical standards
- **Best practice**: Keep short (< 1-2 KB) to avoid token bloat
- **Description field**: Should be blank/empty
- **File naming convention**: End filename with `-always.md`

Example:
```markdown
# .augment/rules/coding-standards-always.md
---
type: always
description: ""
---

✅ Use Prettier with the repo-local configuration
✅ All new React components must be written as function components
✅ Prefer `camelCase` for variables and `PascalCase` for component names
```

#### 2. Manual Rules (`type: manual`)
- **Behavior**: Applied only when explicitly attached via "@ attach" UI chip
- **Usage**: Specialized guidelines for specific contexts
- **Description field**: Brief description for identification
- **File naming convention**: End filename with `-manual.md`

Example:
```markdown
# .augment/rules/project-guidelines-manual.md
---
type: manual
description: "Project-specific development guidelines and architecture patterns"
---

## Architecture Guidelines
- Use clean architecture principles
- Separate business logic from UI components
```

#### 3. Auto Rules (`type: auto`)
- **Behavior**: Augment automatically loads when description matches user query
- **Usage**: Domain-specific documentation and context-aware guidance
- **Description field**: Detailed description used for matching
- **Tags**: Optional tags for better organization and discovery
- **File naming convention**: End filename with `-auto.md`

Example:
```markdown
# .augment/rules/onboarding-checklist-auto.md
---
type: auto
description: |
  Attach when the user asks for "new dev", "onboarding", "project tour"
tags: [onboarding, documentation]
---

*Read the architecture overview in docs/architecture.md*
*Create a personal feature flag in `config/featureFlags.ts`*
```

## Legacy Support

### .augment-guidelines (Deprecated)
- **Location**: Repository root as `.augment-guidelines`
- **Status**: Legacy format, still respected but being phased out
- **Migration**: Will be transparently imported into Rules system
- **Compatibility**: Keep until all team members are on current versions:
  - VS Code: ≥ v0.492.0
  - JetBrains: ≥ v0.197.0

## Best Practices

### File Organization
- Use descriptive filenames with type suffixes (`-always`, `-manual`, `-auto`)
- Keep Always rules minimal and focused
- Use Auto rules for domain-specific documentation
- Organize related rules with consistent tags

### Content Guidelines
- Write clear, actionable instructions
- Use bullet points and structured formatting
- Include specific examples where helpful
- Focus on outcomes rather than implementation details

### Performance Considerations
- Keep Always rules under 1-2 KB
- Use Manual rules for lengthy documentation
- Leverage Auto rules for context-specific content
- Regular review and cleanup of unused rules

## Memory System Integration

### Augment Memories
- **Storage**: Local (not in repository)
- **Scope**: Automatically appear in every Agent/Chat context
- **Conversion**: Can convert memories to rules via UI → Memories → "Save as Rule"
- **Use case**: Personal development preferences and learned patterns

### Memory Bank Pattern (Community Practice)
For teams wanting source-controlled, hierarchical project memory:
```text
.augment/
├── projectbrief.md              # High-level project overview
├── task-logs/                   # Development task history
├── memory-bank/                 # Organized knowledge base
└── rules/                       # Active rule files
```

## File Discovery and Indexing

### Auto-Discovery
- Files in `.augment/rules/` are automatically discovered
- Both `.md` and `.mdc` formats supported
- No build step or configuration required
- Changes take effect after workspace re-index

### Workspace Re-indexing
```bash
# VS Code Command Palette
> Augment: Re-index workspace

# After adding many new rules or moving directories
```

## Integration with Development Workflow

### Team Collaboration
1. Commit `.augment/` directory to version control
2. New team members get rules automatically after clone
3. Rule changes are tracked in pull requests
4. Consistent behavior across all team members

### Rule Management Commands
- **View loaded rules**: Check Augment side panel
- **Attach manual rules**: Use "@ attach" UI chip in chat
- **Convert memories**: UI → Memories → "Save as Rule"

## Validation and Testing

### Rule Effectiveness
- Monitor rule application in chat sessions
- Test Auto rule matching with various query phrases
- Verify Always rules appear in every request
- Review rule content for clarity and actionability

### Common Issues
- **Always rules too verbose**: Split into Manual or Auto rules
- **Auto rules not triggering**: Improve description matching keywords
- **Conflicting rules**: Review and consolidate overlapping guidance

## Version History and Migration

### Recent Updates
- Rules system introduced: July 8, 2025
- Replaces legacy `.augment-guidelines` system
- Enhanced auto-discovery and type-based application
- Improved team collaboration through version control

### Migration Path
1. Existing `.augment-guidelines` automatically imported
2. Gradual migration to new Rules system
3. Legacy format supported during transition
4. Full migration recommended for new projects

## Summary

AugmentCode's Rules system provides a flexible, version-controlled approach to project instruction management:

- **Always Rules**: Critical standards applied to every request
- **Manual Rules**: Specialized guidance attached on-demand  
- **Auto Rules**: Context-aware documentation triggered by query matching
- **Team Collaboration**: Full version control integration
- **Performance Optimized**: Intelligent loading based on rule type
- **Legacy Compatible**: Smooth migration from older formats