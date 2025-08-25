import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { AgentsmdRule } from "./tools/AgentsmdRule.js";
import { ToolRuleConstructor } from "./types.js";
import { fileExists } from "../../utils/file-utils.js";

export class AgentsmdRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new AgentsmdRulesProcessor(params);
	}

	protected getRuleClass(): ToolRuleConstructor {
		return AgentsmdRule as any;
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