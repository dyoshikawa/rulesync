---
root: false
targets: ['*']
description: "Cline rules specification"
globs: []
---

# Cline Rules

https://docs.cline.bot/features/cline-rules

## Overview
A mechanism to provide "system-level guidance" to Cline projects and conversations.

## File Format
- **Location**: `.clinerules/` directory or `Documents/Cline/Rules`
- **File Format**: Markdown files

## Creation Methods
1. Click the "+" button in Rules tab
2. Use `/newrule` slash command in chat
3. Manually create Markdown files

## File Structure Best Practices
- Use clear and concise language
- Focus on expected results
- Organize rules by concern (e.g., documentation, coding standards)
- Control file order with numeric prefixes (optional)

## Folder System Features
- Support multiple rule files within `.clinerules/`
- Can maintain inactive rule sets as "rules bank"
- Support context-specific rule activation
- Easy switching between project contexts

## Advanced Management Features
- Cline v3.13 introduces toggleable popover UI
- Instant display and switching of active rules
- Quick rule file creation and management functionality

## Implementation Tips
- Individual rule files should be focused
- Use descriptive file names
- Consider git-ignoring active `.clinerules/` folder
- Create team scripts for rule combinations