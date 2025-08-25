import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { CursorRule } from "./cursor-rule.js";

export class CursorRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new CursorRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return CursorRule as unknown;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .cursorrules
    const cursorRulesFile = join(this.baseDir, ".cursorrules");
    if (await fileExists(cursorRulesFile)) {
      paths.push(cursorRulesFile);
    }

    // .cursor/rules/*.mdc
    const cursorRulesDir = join(this.baseDir, ".cursor", "rules");
    if (await fileExists(cursorRulesDir)) {
      const ruleFiles = await findFiles(cursorRulesDir, ".mdc");
      paths.push(...ruleFiles);
    }

    return paths;
  }
}
