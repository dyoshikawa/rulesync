import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import glob from "fast-glob";
import { ToolRulesProcessor, ValidationResult } from "../../../types/rules-processor.js";
import { AgentsmdRule } from "../rules/agentsmd-rule.js";
import { RulesyncRule } from "../../rulesync/rules/rulesync-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class AgentsmdRulesProcessor implements ToolRulesProcessor {
	private baseDir: string;

	constructor(params: { baseDir: string }) {
		this.baseDir = params.baseDir;
	}

	static build(params: { baseDir: string }): AgentsmdRulesProcessor {
		return new AgentsmdRulesProcessor(params);
	}

	async generateAllFromRulesyncRuleFiles(): Promise<void> {
		// Load rulesync rule files from .rulesync directory
		const rulesyncDir = join(this.baseDir, ".rulesync");
		if (!(await fileExists(rulesyncDir))) {
			throw new Error(".rulesync directory does not exist");
		}

		const ruleFiles = await glob("*.md", {
			cwd: rulesyncDir,
			absolute: true,
		});

		for (const ruleFile of ruleFiles) {
			// Load rulesync rule
			const rulesyncRule = await RulesyncRule.fromFilePath(ruleFile);
			
			// Convert to AgentsmdRule
			const agentsmdRule = AgentsmdRule.fromRulesyncRule(rulesyncRule);
			
			// Write AgentsmdRule file
			await agentsmdRule.writeFile();
		}
	}

	async generateAllToRulesyncRuleFiles(): Promise<void> {
		// Load AGENTS.md file from project root
		const agentsMdFile = join(this.baseDir, "AGENTS.md");

		const rulesyncDir = join(this.baseDir, ".rulesync");
		await mkdir(rulesyncDir, { recursive: true });

		// Process AGENTS.md if exists
		if (await fileExists(agentsMdFile)) {
			const agentsmdRule = await AgentsmdRule.fromFilePath(agentsMdFile);
			const rulesyncRule = agentsmdRule.toRulesyncRule();
			await rulesyncRule.writeFile();
		}
	}

	async validate(): Promise<ValidationResult> {
		const errors: { filePath: string; error: Error }[] = [];
		
		// Check AGENTS.md
		const agentsMdFile = join(this.baseDir, "AGENTS.md");
		
		if (!(await fileExists(agentsMdFile))) {
			errors.push({
				filePath: agentsMdFile,
				error: new Error("AGENTS.md does not exist")
			});
		} else {
			// Validate AGENTS.md
			try {
				const rule = await AgentsmdRule.fromFilePath(agentsMdFile);
				const ruleValidation = rule.validate();
				if (!ruleValidation.success) {
					errors.push({
						filePath: agentsMdFile,
						error: ruleValidation.error
					});
				}
			} catch (error) {
				errors.push({
					filePath: agentsMdFile,
					error: error as Error
				});
			}
		}

		if (errors.length > 0) {
			return {
				success: false,
				errors
			};
		}

		return {
			success: true,
			errors: []
		};
	}
}