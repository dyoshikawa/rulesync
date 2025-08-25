import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { KiroRule } from "./kiro-rule.js";

export class KiroRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new KiroRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return KiroRule as unknown as ToolRuleConstructor;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .kiro/steering/*.md
    const kiroSteeringDir = join(this.baseDir, ".kiro", "steering");
    if (await fileExists(kiroSteeringDir)) {
      const steeringFiles = await findFiles(kiroSteeringDir, ".md");
      paths.push(...steeringFiles);
    }

    return paths;
  }
}
