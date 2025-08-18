---
root: false
targets: ["*"]
description: Gemini CLI Memory (GEMINI.md) specification for configuration file generation
globs: []
---

# Gemini CLI Memory (GEMINI.md) Specification

## File Placement
- **Project-level memory**: Place `GEMINI.md` in the root of the repository or project directory
- **Global/user memory**: Optional file at `~/.gemini/GEMINI.md` for personal preferences
- **Hierarchical memory**: Multiple GEMINI.md files are concatenated (global first, project last)
- CLI walks up the directory tree to find the first GEMINI.md file

## File Format
- Plain Markdown format - no special frontmatter or JSON required
- Entire file content becomes part of the model context
- Keep under a few thousand tokens for cost efficiency
- Most important guidance should be placed at the top

## Content Structure (Recommended)
```markdown
# Project: <name>
Brief project description (2-3 sentences)

## Tech Stack
- Technology list
- Architecture details

## Coding Standards
1. Style rules
2. Quality requirements
3. Testing requirements

## Mandatory Tooling
Commands that should be run:
```bash
command examples
```

## Build & Run Commands
- Install: command
- Dev server: command
- Tests: command

## Security / Don't-ever-do
- Security restrictions
- File/directory restrictions
```

## CLI Commands
- `/memory show` - View loaded memory content
- `/memory refresh` - Re-read memory files after edits

## Best Practices
- Version control project GEMINI.md for team consistency
- Use global file for personal habits, project file for team rules
- Keep content relevant and up-to-date
- Use clear, plain English instructions