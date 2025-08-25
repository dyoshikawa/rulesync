import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file.js";
import { ToolRuleConstructor } from "../types.js";
import { AmazonqcliRule } from "./amazonqcli-rule.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";

export class AmazonqcliRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new AmazonqcliRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return AmazonqcliRule as unknown as ToolRuleConstructor;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .amazonq/rules/*.md
    const amazonqRulesDir = join(this.baseDir, ".amazonq", "rules");
    if (await fileExists(amazonqRulesDir)) {
      const ruleFiles = await findFiles(amazonqRulesDir, ".md");
      paths.push(...ruleFiles);
    }

    return paths;
  }
}
