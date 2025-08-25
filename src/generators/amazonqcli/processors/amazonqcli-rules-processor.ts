import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { AmazonqcliRule } from "../rules/amazonqcli-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class AmazonqcliRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new AmazonqcliRulesProcessor(params);
	}

	protected getRuleClass(): typeof AmazonqcliRule {
		return AmazonqcliRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .amazonq/rules/*.md
		const amazonqRulesDir = join(this.baseDir, ".amazonq", "rules");
		if (await fileExists(amazonqRulesDir)) {
			const ruleFiles = await glob("*.md", {
				cwd: amazonqRulesDir,
				absolute: true,
			});
			paths.push(...ruleFiles);
		}

		return paths;
	}
}