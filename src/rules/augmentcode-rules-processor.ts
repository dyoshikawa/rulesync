import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { AugmentcodeRule } from "./tools/AugmentcodeRule.js";
import { ToolRuleConstructor } from "./types.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";

export class AugmentcodeRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new AugmentcodeRulesProcessor(params);
	}

	protected getRuleClass(): ToolRuleConstructor {
		return AugmentcodeRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .augment/rules/*.md
		const augmentRulesDir = join(this.baseDir, ".augment", "rules");
		if (await fileExists(augmentRulesDir)) {
			const ruleFiles = await findFiles(augmentRulesDir, ".md");
			paths.push(...ruleFiles);
		}

		return paths;
	}
}