# Kiro Rules and Steering Documentation Specification

## Overview
Kiro is an AI-powered IDE released by AWS that uses a spec-driven development approach. Instead of traditional "rules" or "memories" files like other AI coding tools, Kiro uses two main documentation systems: **Specs** and **Steering Documents**.

## Core Folder Structure
All Kiro metadata is stored in a hidden `.kiro/` folder at the repository root:

```
.kiro/
├── specs/                # Feature specifications
│   ├── requirements.md   # User/business requirements
│   ├── design.md         # High-level architecture
│   └── tasks.md          # Granular task list
├── steering/             # Permanent project context
│   ├── product.md        # Product vision & UX rules
│   ├── structure.md      # Directory map/module layout
│   └── tech.md           # Stack, language, style guides
├── hooks/                # YAML or JSON hook definitions
└── mcp.json              # Model-Context-Protocol servers
```

## 1. Specs - Feature Specification System

### Purpose
Specs are Kiro's way of managing feature development through structured documentation. Each spec represents a distinct feature or major change.

### File Structure
Each spec lives in its own subdirectory under `.kiro/specs/`:
- **requirements.md**: User/business requirements for the feature
- **design.md**: High-level architecture and design decisions
- **tasks.md**: Granular task breakdown for implementation

### Creating and Managing Specs
1. Open the right-hand chat panel in Kiro
2. Choose "Spec session" mode
3. Describe the feature - Kiro will ask clarifying questions
4. Kiro automatically creates/updates the three spec files
5. You can manually edit the files or use "Refine" in chat to iterate

### Best Practices
- One spec per feature is recommended
- Multiple independent specs can exist under `.kiro/specs/`
- Specs can be refined at any time during development
- Keep specs focused on a single feature or capability

## 2. Steering Documents - Project Context

### Purpose
Steering documents are the "living engineering handbook" for your project. They provide permanent context that applies to every prompt and interaction with Kiro.

### Core Steering Files
1. **product.md**
   - Target users and personas
   - Non-functional requirements
   - Release criteria and quality standards
   - User experience guidelines

2. **structure.md**
   - Repository/monorepo layout
   - Module boundaries and dependencies
   - Naming conventions
   - Directory organization principles

3. **tech.md**
   - Language versions and runtimes
   - Framework choices and libraries
   - Coding standards and style guides
   - Build and deployment tooling

### Generating Steering Documents
- Use Command Palette → "Generate Steering Docs" for initial creation
- Kiro automatically generates the three core files based on project analysis

### Adding Custom Steering Documents
You can add additional steering documents as needed:
- Create a new `.md` file in `.kiro/steering/`
- Use Command Palette → "Refine" to let Kiro expand the content
- Examples: `libraries.md` for dependency policies, `security.md` for security guidelines

## 3. Agent Hooks - Automated Context Application

### Purpose
Hooks provide background automation that can modify or enhance the context based on events.

### Hook Configuration
Hooks are defined in YAML or JSON files in `.kiro/hooks/`:

```yaml
name: Update-Context
description: Update documentation when source changes
on:
  - event: file_saved
    glob: ["src/**/*.ts", "src/**/*.tsx"]
run:
  prompt: |
    After each save, ensure steering docs reflect any new patterns or conventions introduced.
enabled: true
```

### Managing Hooks
- Create/manage via the Ghost-icon side-panel → "Agent Hooks"
- Hooks can watch for: file saves, creates, deletes, or manual triggers
- Each hook runs an agent with specific instructions

## 4. Integration with Development Workflow

### Spec-Driven Development
1. Start with a spec session to define requirements
2. Kiro uses specs to guide implementation
3. Tasks from `tasks.md` can be tracked and completed
4. Specs evolve as understanding improves

### Continuous Context
- Steering documents are always loaded in context
- They influence all code generation and suggestions
- Updates to steering docs immediately affect Kiro's behavior

### Command Palette Actions
- `Kiro: New Spec Session` - Start a new feature spec
- `Kiro: Setup Steering` - Generate initial steering docs
- `Kiro: Refine` - Update and expand documentation with AI assistance

## 5. Best Practices

### Organization
- Keep specs focused on single features
- Maintain clear separation between specs and steering
- Use descriptive names for spec directories
- Regular review and update of steering documents

### Content Guidelines
- Write in clear, concise language
- Focus on outcomes and requirements, not implementation details
- Include examples where helpful
- Keep documentation up-to-date with code changes

### Version Control
- Commit `.kiro/` folder to version control
- This ensures team members share the same context
- Review changes to specs and steering in pull requests
- Use `.gitignore` for any sensitive configuration

## 6. Key Differences from Other AI Tools

Unlike other AI coding assistants that use simple rules or memory files:
- Kiro uses structured specification documents
- Separation between feature specs and project steering
- Automatic generation and refinement through AI interaction
- Deep integration with the development workflow
- Hooks for automated context updates

## Summary

Kiro's approach to project context and rules is fundamentally different from other AI coding tools. Instead of a single "rules" or "memory" file, it uses:
- **Specs** for feature-specific requirements and design
- **Steering documents** for project-wide context and standards
- **Hooks** for automated context management
- All stored in a structured `.kiro/` directory that travels with your code