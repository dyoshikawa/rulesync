import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { CopilotRule } from "./copilot-rule.js";

export class CopilotRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new CopilotRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return CopilotRule as unknown;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .github/copilot-instructions.md
    const copilotInstructionsFile = join(this.baseDir, ".github", "copilot-instructions.md");
    if (await fileExists(copilotInstructionsFile)) {
      paths.push(copilotInstructionsFile);
    }

    // .github/instructions/*.instructions.md
    const instructionsDir = join(this.baseDir, ".github", "instructions");
    if (await fileExists(instructionsDir)) {
      const instructionFiles = await findFiles(instructionsDir, ".instructions.md");
      paths.push(...instructionFiles);
    }

    return paths;
  }
}
