import { join } from "node:path";
import glob from "fast-glob";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { CopilotRule } from "../rules/copilot-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class CopilotRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new CopilotRulesProcessor(params);
	}

	protected getRuleClass(): typeof CopilotRule {
		return CopilotRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// .github/copilot-instructions.md
		const copilotInstructionsFile = join(this.baseDir, ".github", "copilot-instructions.md");
		if (await fileExists(copilotInstructionsFile)) {
			paths.push(copilotInstructionsFile);
		}

		// .github/instructions/*.instructions.md
		const instructionsDir = join(this.baseDir, ".github", "instructions");
		if (await fileExists(instructionsDir)) {
			const instructionFiles = await glob("*.instructions.md", {
				cwd: instructionsDir,
				absolute: true,
			});
			paths.push(...instructionFiles);
		}

		return paths;
	}
}