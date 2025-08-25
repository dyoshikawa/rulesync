import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { ClineRule } from "../rules/cline-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class ClineRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new ClineRulesProcessor(params);
	}

	protected getRuleClass(): typeof ClineRule {
		return ClineRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .clinerules
		const clineRulesFile = join(this.baseDir, ".clinerules");
		if (await fileExists(clineRulesFile)) {
			paths.push(clineRulesFile);
		}

		// .clinerules/*.md
		const clineRulesDir = join(this.baseDir, ".clinerules");
		if (await fileExists(clineRulesDir)) {
			const ruleFiles = await glob("*.md", {
				cwd: clineRulesDir,
				absolute: true,
			});
			paths.push(...ruleFiles);
		}

		return paths;
	}
}