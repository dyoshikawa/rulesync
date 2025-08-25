import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { JunieRule } from "./junie-rule.js";

export class JunieRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new JunieRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return JunieRule as unknown;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .junie/guidelines.md
    const junieGuidelinesFile = join(this.baseDir, ".junie", "guidelines.md");
    if (await fileExists(junieGuidelinesFile)) {
      paths.push(junieGuidelinesFile);
    }

    return paths;
  }
}
