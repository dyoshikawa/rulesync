import { join } from "node:path";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { CodexcliRule } from "../rules/codexcli-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class CodexcliRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new CodexcliRulesProcessor(params);
	}

	protected getRuleClass(): typeof CodexcliRule {
		return CodexcliRule as any;
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