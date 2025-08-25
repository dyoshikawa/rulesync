import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { QwencodeRule } from "./tools/QwencodeRule.js";
import { ToolRuleConstructor } from "./types.js";
import { fileExists } from "../../utils/file-utils.js";

export class QwencodeRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new QwencodeRulesProcessor(params);
	}

	protected getRuleClass(): ToolRuleConstructor {
		return QwencodeRule as any;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		const paths: string[] = [];
		
		// QWEN.md
		const qwenMdFile = join(this.baseDir, "QWEN.md");
		if (await fileExists(qwenMdFile)) {
			paths.push(qwenMdFile);
		}

		// .qwen/QWEN.md
		const qwenDirFile = join(this.baseDir, ".qwen", "QWEN.md");
		if (await fileExists(qwenDirFile)) {
			paths.push(qwenDirFile);
		}

		return paths;
	}
}