import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { RooRule } from "./tools/RooRule.js";
import { ToolRuleConstructor } from "./types.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";

export class RooRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new RooRulesProcessor(params);
	}

	protected getRuleClass(): ToolRuleConstructor {
		return RooRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .roorules
		const rooRulesFile = join(this.baseDir, ".roorules");
		if (await fileExists(rooRulesFile)) {
			paths.push(rooRulesFile);
		}

		// .roo/rules/*.md
		const rooRulesDir = join(this.baseDir, ".roo", "rules");
		if (await fileExists(rooRulesDir)) {
			const ruleFiles = await findFiles(rooRulesDir, ".md");
			paths.push(...ruleFiles);
		}

		// .roo/memories/*.md
		const rooMemoriesDir = join(this.baseDir, ".roo", "memories");
		if (await fileExists(rooMemoriesDir)) {
			const memoryFiles = await findFiles(rooMemoriesDir, ".md");
			paths.push(...memoryFiles);
		}

		return paths;
	}
}