import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { AugmentcodeRule } from "../rules/augmentcode-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class AugmentcodeRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new AugmentcodeRulesProcessor(params);
	}

	protected getRuleClass(): typeof AugmentcodeRule {
		return AugmentcodeRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .augment/rules/*.md
		const augmentRulesDir = join(this.baseDir, ".augment", "rules");
		if (await fileExists(augmentRulesDir)) {
			const ruleFiles = await glob("*.md", {
				cwd: augmentRulesDir,
				absolute: true,
			});
			paths.push(...ruleFiles);
		}

		return paths;
	}
}