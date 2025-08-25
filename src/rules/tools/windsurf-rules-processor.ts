import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { WindsurfRule } from "./windsurf-rule.js";

export class WindsurfRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new WindsurfRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return WindsurfRule as any;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .windsurf-rules
    const windsurfRulesFile = join(this.baseDir, ".windsurf-rules");
    if (await fileExists(windsurfRulesFile)) {
      paths.push(windsurfRulesFile);
    }

    // .windsurf/rules/*.md
    const windsurfRulesDir = join(this.baseDir, ".windsurf", "rules");
    if (await fileExists(windsurfRulesDir)) {
      const ruleFiles = await findFiles(windsurfRulesDir, ".md");
      paths.push(...ruleFiles);
    }

    return paths;
  }
}
