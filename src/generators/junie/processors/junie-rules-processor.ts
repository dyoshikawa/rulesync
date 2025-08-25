import { join } from "node:path";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { JunieRule } from "../rules/junie-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class JunieRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new JunieRulesProcessor(params);
	}

	protected getRuleClass(): typeof JunieRule {
		return JunieRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .junie/guidelines.md
		const junieGuidelinesFile = join(this.baseDir, ".junie", "guidelines.md");
		if (await fileExists(junieGuidelinesFile)) {
			paths.push(junieGuidelinesFile);
		}

		return paths;
	}
}