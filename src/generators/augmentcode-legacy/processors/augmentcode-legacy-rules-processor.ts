import { join } from "node:path";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { AugmentcodeLegacyRule } from "../rules/augmentcode-legacy-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class AugmentcodeLegacyRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new AugmentcodeLegacyRulesProcessor(params);
	}

	protected getRuleClass(): typeof AugmentcodeLegacyRule {
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