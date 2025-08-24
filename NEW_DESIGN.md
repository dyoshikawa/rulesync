# About New Design of Rulesync

## Overview, Background and Purpose

This document describes the new design guidelines for the Rulesync project.

The Conventional codebase does not have consistent structures, and the code is not easy to understand and maintain. Especially when the external contributors want to contribute to implement supports for new AI coding tools, they may not be able to understand how to implement them.

So, we need to redesign the codebase to make it more consistent and easy to understand and maintain. Specifically, consistent interfaces and classes should be prepared to make it easier for external contributors to implement supports for new AI coding tools.

## New Design in Details

### Rules

```ts
interface Rule {
  static buildFromFilePath(filePath: string): Promise<Rule>
  writeFile(filePath: string): Promise<void>
}

interface ToolRule extends Rule {
  static buildFromFilePath(filePath: string): Promise<ToolRule>
  writeFile(filePath: string): Promise<void>

  toRulesyncRule(): RulesyncRule
  static fromRulesyncRule(rule: RulesyncRule): ToolRule
}

class ClaudecodeRule implements ToolRule {
  static buildFromFilePath(filePath: string): Promise<ClaudecodeRule>
  writeFile(): Promise<void>

  toRulesyncRule(): RulesyncRule
  static fromRulesyncRule(rule: RulesyncRule): ToolRule
}

interface RulesyncRuleData {
  dataType: "rulesync_rule"
  frontmatter: {
    targets?: ToolTarget[]
    description?: string
  }
  body: string
  filePath: string
}

class RulesyncRule implements Rule {
  private data: RulesyncRuleData

  getFilePath(): string
  getFileContent(): string
  static build(filePath: string, fileContent: string): RulesyncRule
  toData(): RulesyncRuleData
}
```

## TODO

Every time you complete each replacement of the codes, please update the TODO list below.

### Rules

- [ ] claudecode
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
- [ ] claudecode
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
- [ ] claudecode
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

## Subagents

- [ ] claudecode
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
