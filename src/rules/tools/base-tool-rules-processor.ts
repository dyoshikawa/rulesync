import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ToolRulesProcessor, ValidationResult } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { ToolRuleConstructor } from "../types.js";

export abstract class BaseToolRulesProcessor implements ToolRulesProcessor {
  protected baseDir: string;

  constructor(params: { baseDir: string }) {
    this.baseDir = params.baseDir;
  }

  static build(_params: { baseDir: string }): ToolRulesProcessor {
    throw new Error("Subclass must implement static build method");
  }

  protected abstract getRuleClass(): ToolRuleConstructor;
  protected abstract getRuleFilePaths(): Promise<string[]>;

  async generateAllFromRulesyncRuleFiles(): Promise<void> {
    // Load rulesync rule files from .rulesync directory
    const rulesyncDir = this.getRulesyncDirectory();
    if (!(await fileExists(rulesyncDir))) {
      throw new Error(".rulesync directory does not exist");
    }

    const ruleFiles = await findFiles(rulesyncDir, ".md");

    const RuleClass = this.getRuleClass();

    for (const ruleFile of ruleFiles) {
      // Load rulesync rule
      const rulesyncRule = await RulesyncRule.fromFilePath(ruleFile);

      // Convert to specific ToolRule
      const toolRule = RuleClass.fromRulesyncRule(rulesyncRule);

      // Write ToolRule file
      await toolRule.writeFile();
    }
  }

  async generateAllToRulesyncRuleFiles(): Promise<void> {
    const rulesyncDir = this.getRulesyncDirectory();
    await mkdir(rulesyncDir, { recursive: true });

    const RuleClass = this.getRuleClass();
    const ruleFilePaths = await this.getRuleFilePaths();

    for (const ruleFilePath of ruleFilePaths) {
      if (await fileExists(ruleFilePath)) {
        const toolRule = await RuleClass.fromFilePath(ruleFilePath);
        const rulesyncRule = toolRule.toRulesyncRule();
        await rulesyncRule.writeFile();
      }
    }
  }

  async validate(): Promise<ValidationResult> {
    const errors: { filePath: string; error: Error }[] = [];
    const RuleClass = this.getRuleClass();
    const ruleFilePaths = await this.getRuleFilePaths();

    // Check if any rule files exist
    let hasAnyRuleFile = false;
    for (const ruleFilePath of ruleFilePaths) {
      if (await fileExists(ruleFilePath)) {
        hasAnyRuleFile = true;
        // Validate the rule file
        try {
          const rule = await RuleClass.fromFilePath(ruleFilePath);
          const ruleValidation = rule.validate();
          if (!ruleValidation.success) {
            errors.push({
              filePath: ruleFilePath,
              error: ruleValidation.error,
            });
          }
        } catch (error) {
          errors.push({
            filePath: ruleFilePath,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    if (!hasAnyRuleFile) {
      errors.push({
        filePath: this.baseDir,
        error: new Error(`No rule files found for ${this.constructor.name}`),
      });
    }

    if (errors.length > 0) {
      return {
        success: false,
        errors,
      };
    }

    return {
      success: true,
      errors: [],
    };
  }

  protected getRulesyncDirectory(): string {
    return join(this.baseDir, ".rulesync");
  }
}
