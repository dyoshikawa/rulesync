import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { AgentsmdRule } from "./agentsmd-rule.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";

export class AgentsmdRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new AgentsmdRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return AgentsmdRule as unknown;
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
