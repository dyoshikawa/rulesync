import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import glob from "fast-glob";
import { ToolRulesProcessor, ValidationResult } from "../../../types/rules-processor.js";
import { ClaudecodeRule } from "../rules/claudecode-rule.js";
import { RulesyncRule } from "../../rulesync/rules/rulesync-rule.js";
import { fileExists } from "../../../utils/file-utils.js";

export class ClaudecodeRulesProcessor implements ToolRulesProcessor {
	private baseDir: string;

	constructor(params: { baseDir: string }) {
		this.baseDir = params.baseDir;
	}

	static build(params: { baseDir: string }): ClaudecodeRulesProcessor {
		return new ClaudecodeRulesProcessor(params);
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
			
			// Convert to ClaudecodeRule
			const claudecodeRule = ClaudecodeRule.fromRulesyncRule(rulesyncRule);
			
			// Write ClaudecodeRule file
			await claudecodeRule.writeFile();
		}
	}

	async generateAllToRulesyncRuleFiles(): Promise<void> {
		// Load claudecode rule files from .claude/memories/
		const claudeDir = join(this.baseDir, ".claude");
		const claudeMemoriesDir = join(claudeDir, "memories");
		const claudeMdFile = join(this.baseDir, "CLAUDE.md");

		const rulesyncDir = join(this.baseDir, ".rulesync");
		await mkdir(rulesyncDir, { recursive: true });

		// Process CLAUDE.md if exists
		if (await fileExists(claudeMdFile)) {
			const claudecodeRule = await ClaudecodeRule.fromFilePath(claudeMdFile);
			const rulesyncRule = claudecodeRule.toRulesyncRule();
			await rulesyncRule.writeFile();
		}

		// Process .claude/memories/*.md files
		if (await fileExists(claudeMemoriesDir)) {
			const memoryFiles = await glob("*.md", {
				cwd: claudeMemoriesDir,
				absolute: true,
			});

			for (const memoryFile of memoryFiles) {
				const claudecodeRule = await ClaudecodeRule.fromFilePath(memoryFile);
				const rulesyncRule = claudecodeRule.toRulesyncRule();
				await rulesyncRule.writeFile();
			}
		}
	}

	async validate(): Promise<ValidationResult> {
		const errors: { filePath: string; error: Error }[] = [];
		
		// Check CLAUDE.md or .claude directory
		const claudeMdFile = join(this.baseDir, "CLAUDE.md");
		const claudeDir = join(this.baseDir, ".claude");
		
		const hasClaudeMd = await fileExists(claudeMdFile);
		const hasClaudeDir = await fileExists(claudeDir);
		
		if (!hasClaudeMd && !hasClaudeDir) {
			errors.push({
				filePath: this.baseDir,
				error: new Error("Neither CLAUDE.md nor .claude directory exists")
			});
		}

		// Validate CLAUDE.md if exists
		if (hasClaudeMd) {
			try {
				const rule = await ClaudecodeRule.fromFilePath(claudeMdFile);
				const ruleValidation = rule.validate();
				if (!ruleValidation.success) {
					errors.push({
						filePath: claudeMdFile,
						error: ruleValidation.error
					});
				}
			} catch (error) {
				errors.push({
					filePath: claudeMdFile,
					error: error as Error
				});
			}
		}

		// Validate .claude/memories/*.md files
		if (hasClaudeDir) {
			const memoriesDir = join(claudeDir, "memories");
			if (await fileExists(memoriesDir)) {
				const memoryFiles = await glob("*.md", {
					cwd: memoriesDir,
					absolute: true,
				});

				for (const memoryFile of memoryFiles) {
					try {
						const rule = await ClaudecodeRule.fromFilePath(memoryFile);
						const ruleValidation = rule.validate();
						if (!ruleValidation.success) {
							errors.push({
								filePath: memoryFile,
								error: ruleValidation.error
							});
						}
					} catch (error) {
						errors.push({
							filePath: memoryFile,
							error: error as Error
						});
					}
				}
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