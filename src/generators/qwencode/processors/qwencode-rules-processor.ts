import { join } from "node:path";
import { ToolRulesProcessor } from "../../../types/rules-processor.js";
import { BaseToolRulesProcessor } from "../../common/base-tool-rules-processor.js";
import { QwencodeRule } from "../rules/qwencode-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class QwencodeRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }): ToolRulesProcessor {
		return new QwencodeRulesProcessor(params);
	}

	protected getRuleClass(): typeof QwencodeRule {
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