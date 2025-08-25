# Rules of New Design

## Rule interfaces and classes

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

Every time you complete each replacement of the codes, please update the TODO list below.

- [x] claudecode
- [x] agentsmd
- [x] amazonqcli
- [x] augmentcode
- [x] augmentcode-legacy
- [x] copilot
- [x] cursor
- [x] cline
- [x] claudecode
- [x] codexcli
- [x] opencode
- [x] qwencode
- [x] roo
- [x] geminicli
- [x] kiro
- [x] junie
- [x] windsurf

## RulesProcessor interfaces and classes

```ts
type ValidationResult = {
  success: true
  errors: []
} | {
  success: false
  errors: {
    filePath: string
    error: Error
  }[]
}

interface RulesProcessor {
  validate(): Promise<ValidationResult>
}

interface ToolRulesProcessor extends RulesProcessor {
  // `rulesync generate --base-dir {dir}` option is used to set the base directory of generated rules.
  // Example:
  // `rulesync generate --targets claudecode --features rules --base-dir .` => `./CLAUDE.md` and `./.claude/memories/*.md`
  // `rulesync generate --targets claudecode --features rules --base-dir ./a` => `./a/CLAUDE.md` and `./a/.claude/memories/*.md`
  static build(params: { baseDir: string }): ToolRulesProcessor

  // `rulesync generate` process. Load rulesync rule files, and then generate tool rule files.
  generateAllFromRulesyncRuleFiles(): Promise<void>

  // `rulesync import` process. Load tool rule files, and then generate rulesync rule files.
  generateAllToRulesyncRuleFiles(): Promise<void>

  validate(): Promise<ValidationResult>
}

// claudecode rules processor example
class ClaudecodeRulesProcessor implements ToolRulesProcessor {
  static build(params: { baseDir: string }): ClaudecodeRulesProcessor

  generateAllFromRulesyncRuleFiles(): Promise<void>

  generateAllToRulesyncRuleFiles(): Promise<void>

  validate(): Promise<ValidationResult>
}

class RulesyncRulesProcessor implements RulesProcessor {
  static build(): RulesyncRulesProcessor
  
  // For `rulesync init` and `rulesync add` process. Create a single new rulesync rule file.
  generate(rule: RuleSyncRule): Promise<void>

  validate(): Promise<ValidationResult>
}
```

Every time you complete each replacement of the codes, please update the TODO list below.

- [x] claudecode
- [x] agentsmd
- [x] amazonqcli
- [x] augmentcode
- [x] augmentcode-legacy
- [x] copilot
- [x] cursor
- [x] cline
- [x] codexcli
- [x] opencode
- [x] qwencode
- [x] roo
- [x] geminicli
- [x] kiro
- [x] junie
- [x] windsurf
