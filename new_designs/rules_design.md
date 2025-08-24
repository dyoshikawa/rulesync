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

## RulesProcessor class

```ts
interface RulesProcessor {
  generate(): Promise<void>
  // Load rules from files
  load(paths: string[]): Promise<void>
  // Import a rule from a file
  importFrom(filePath: string): Promise<Rule>
}

interface ToolRulesProcessor extends RulesProcessor {
  generate(): Promise<void>
  load(paths: string[]): Promise<void>
  importFrom(filePath: string): Promise<Rule>
}

class RulesyncRulesProcessor implements RulesProcessor {
  generate(): Promise<void>
  load(paths: string[]): Promise<void>
  importFrom(filePath: string): Promise<Rule>
}
```

