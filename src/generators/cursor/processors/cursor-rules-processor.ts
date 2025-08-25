import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { CursorRule } from "../rules/cursor-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class CursorRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new CursorRulesProcessor(params);
	}

	protected getRuleClass(): typeof CursorRule {
		return CursorRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .cursorrules
		const cursorRulesFile = join(this.baseDir, ".cursorrules");
		if (await fileExists(cursorRulesFile)) {
			paths.push(cursorRulesFile);
		}

		// .cursor/rules/*.mdc
		const cursorRulesDir = join(this.baseDir, ".cursor", "rules");
		if (await fileExists(cursorRulesDir)) {
			const ruleFiles = await glob("*.mdc", {
				cwd: cursorRulesDir,
				absolute: true,
			});
			paths.push(...ruleFiles);
		}

		return paths;
	}
}