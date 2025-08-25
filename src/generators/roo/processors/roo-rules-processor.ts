import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { RooRule } from "../rules/roo-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class RooRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new RooRulesProcessor(params);
	}

	protected getRuleClass(): typeof RooRule {
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
			const ruleFiles = await glob("*.md", {
				cwd: rooRulesDir,
				absolute: true,
			});
			paths.push(...ruleFiles);
		}

		// .roo/memories/*.md
		const rooMemoriesDir = join(this.baseDir, ".roo", "memories");
		if (await fileExists(rooMemoriesDir)) {
			const memoryFiles = await glob("*.md", {
				cwd: rooMemoriesDir,
				absolute: true,
			});
			paths.push(...memoryFiles);
		}

		return paths;
	}
}