import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { KiroRule } from "../rules/kiro-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class KiroRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new KiroRulesProcessor(params);
	}

	protected getRuleClass(): typeof KiroRule {
		return KiroRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .kiro/steering/*.md
		const kiroSteeringDir = join(this.baseDir, ".kiro", "steering");
		if (await fileExists(kiroSteeringDir)) {
			const steeringFiles = await glob("*.md", {
				cwd: kiroSteeringDir,
				absolute: true,
			});
			paths.push(...steeringFiles);
		}

		return paths;
	}
}