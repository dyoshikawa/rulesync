# About New Design of Rulesync

## Overview, Background and Purpose

This document describes the new design guidelines for the Rulesync project.

The Conventional codebase does not have consistent structures, and the code is not easy to understand and maintain. Especially when the external contributors want to contribute to implement supports for new AI coding tools, they may not be able to understand how to implement them.

So, we need to redesign the codebase to make it more consistent and easy to understand and maintain. Specifically, consistent interfaces and classes should be prepared to make it easier for external contributors to implement supports for new AI coding tools.

## Immediate goals

My immediate goal is replacing the rules generation logics.

Others that are mcp, ignore, commands and subagents should not be replaced yet.

Attention, the replacements must not break the existing behaviors.

At key points, you should commit your changes actively.

## New Design in Details

### Rules

```ts
type ValidationResult = {
  success: true
  error: null
} | {
  success: false
  error: Error
}

interface Rule {
  static build(params: {filePath: string, fileContent: string}): Rule
  // Read an actual file
  static fromFilePath(filePath: string): Promise<Rule>
  writeFile(): Promise<void>
  validate(): ValidationResult
  getFilePath(): string
  getFileContent(): string
}

class RulesyncRule implements Rule {
  static build(params: {filePath: string, fileContent: string}): RulesyncRule
  static fromFilePath(filePath: string): Promise<RulesyncRule>
  writeFile(): Promise<void>
  validate(): ValidationResult
  getFilePath(): string
  getFileContent(): string
}

interface ToolRule extends Rule {
  static build(params: {filePath: string, fileContent: string}): ToolRule
  static fromFilePath(filePath: string): Promise<ToolRule>
  writeFile(): Promise<void>
  toRulesyncRule(): RulesyncRule
  static fromRulesyncRule(rule: RulesyncRule): ToolRule
  getFilePath(): string
  getFileContent(): string
}

// claudecode example:
class ClaudecodeRule implements ToolRule {
  static build(params: {filePath: string, fileContent: string}): ClaudecodeRule
  static fromFilePath(filePath: string): Promise<ClaudecodeRule>
  writeFile(): Promise<void>
  toRulesyncRule(): RulesyncRule
  static fromRulesyncRule(rule: RulesyncRule): ClaudecodeRule
  getFilePath(): string
  getFileContent(): string
}
```

## TODO

Every time you complete each replacement of the codes, please update the TODO list below.

### Rules

- [x] claudecode
- [ ] agentsmd
- [ ] amazonqcli
- [ ] augmentcode
- [ ] augmentcode-legacy
- [ ] copilot
- [ ] cursor
- [ ] cline
- [ ] claudecode
- [ ] codexcli
- [ ] opencode
- [ ] qwencode
- [ ] roo
- [ ] geminicli
- [ ] kiro
- [ ] junie
- [ ] windsurf

## MCP

- [ ] claudecode
- [ ] agentsmd
- [ ] amazonqcli
- [ ] augmentcode
- [ ] augmentcode-legacy
- [ ] copilot
- [ ] cursor
- [ ] cline
- [ ] codexcli
- [ ] opencode
- [ ] qwencode
- [ ] roo
- [ ] geminicli
- [ ] kiro
- [ ] junie
- [ ] windsurf

## Ignore

- [ ] claudecode
- [ ] agentsmd
- [ ] amazonqcli
- [ ] augmentcode
- [ ] augmentcode-legacy
- [ ] copilot
- [ ] cursor
- [ ] cline
- [ ] codexcli
- [ ] opencode
- [ ] qwencode
- [ ] roo
- [ ] geminicli
- [ ] kiro
- [ ] junie
- [ ] windsurf

## Commands

- [ ] claudecode
- [ ] geminicli
- [ ] roo

## Subagents

- [ ] claudecode
