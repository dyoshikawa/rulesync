import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { WindsurfRule } from "../rules/windsurf-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class WindsurfRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new WindsurfRulesProcessor(params);
	}

	protected getRuleClass(): typeof WindsurfRule {
		return WindsurfRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .windsurf-rules
		const windsurfRulesFile = join(this.baseDir, ".windsurf-rules");
		if (await fileExists(windsurfRulesFile)) {
			paths.push(windsurfRulesFile);
		}

		// .windsurf/rules/*.md
		const windsurfRulesDir = join(this.baseDir, ".windsurf", "rules");
		if (await fileExists(windsurfRulesDir)) {
			const ruleFiles = await glob("*.md", {
				cwd: windsurfRulesDir,
				absolute: true,
			});
			paths.push(...ruleFiles);
		}

		return paths;
	}
}