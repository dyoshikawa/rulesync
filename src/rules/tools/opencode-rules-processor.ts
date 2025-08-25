import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { OpencodeRule } from "./opencode-rule.js";

export class OpencodeRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new OpencodeRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return OpencodeRule as any;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // AGENTS.md
    const agentsMdFile = join(this.baseDir, "AGENTS.md");
    if (await fileExists(agentsMdFile)) {
      paths.push(agentsMdFile);
    }

    return paths;
  }
}
