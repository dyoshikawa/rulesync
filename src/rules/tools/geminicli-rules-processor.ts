import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { GeminicliRule } from "./geminicli-rule.js";

export class GeminicliRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new GeminicliRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return GeminicliRule as unknown;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // GEMINI.md
    const geminiMdFile = join(this.baseDir, "GEMINI.md");
    if (await fileExists(geminiMdFile)) {
      paths.push(geminiMdFile);
    }

    // .gemini/GEMINI.md
    const geminiDirFile = join(this.baseDir, ".gemini", "GEMINI.md");
    if (await fileExists(geminiDirFile)) {
      paths.push(geminiDirFile);
    }

    return paths;
  }
}
