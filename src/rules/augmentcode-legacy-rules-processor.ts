import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { AugmentcodeLegacyRule } from "./tools/AugmentcodeLegacyRule.js";
import { ToolRuleConstructor } from "./types.js";
import { fileExists } from "../../utils/file-utils.js";

export class AugmentcodeLegacyRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new AugmentcodeLegacyRulesProcessor(params);
	}

	protected getRuleClass(): ToolRuleConstructor {
		return AugmentcodeLegacyRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .augment-guidelines (legacy file)
		const legacyFile = join(this.baseDir, ".augment-guidelines");
		if (await fileExists(legacyFile)) {
			paths.push(legacyFile);
		}

		return paths;
	}
}