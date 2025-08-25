import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { ClineRule } from "./cline-rule.js";

export class ClineRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new ClineRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return ClineRule as any;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .clinerules
    const clineRulesFile = join(this.baseDir, ".clinerules");
    if (await fileExists(clineRulesFile)) {
      paths.push(clineRulesFile);
    }

    // .clinerules/*.md
    const clineRulesDir = join(this.baseDir, ".clinerules");
    if (await fileExists(clineRulesDir)) {
      const ruleFiles = await findFiles(clineRulesDir, ".md");
      paths.push(...ruleFiles);
    }

    return paths;
  }
}
