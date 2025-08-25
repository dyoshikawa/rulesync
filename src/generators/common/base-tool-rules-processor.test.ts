import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { ToolRule } from "../../types/rules.js";
import { RulesyncRule } from "../rulesync/rules/rulesync-rule.js";
import { setupTestDirectory } from "../../test-utils/index.js";
import { fileExists } from "../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		mkdir: vi.fn(),
	};
});

vi.mock("../../types/rules.js", () => ({
	ToolRule: {
		fromRulesyncRule: vi.fn(),
		fromFilePath: vi.fn(),
	},
}));

vi.mock("../rulesync/rules/rulesync-rule.js", () => ({
	RulesyncRule: {
		fromFilePath: vi.fn(),
	},
}));

// Concrete implementation for testing
class TestToolRulesProcessor extends BaseToolRulesProcessor {
	static build(params: { baseDir: string }) {
		return new TestToolRulesProcessor(params);
	}

	protected getRuleClass() {
		return ToolRule;
	}

	protected async getRuleFilePaths(): Promise<string[]> {
		return [
			join(this.baseDir, ".test-rules"),
			join(this.baseDir, "config", "test.md"),
		];
	}

	protected getRulesyncDirectory(): string {
		return join(this.baseDir, ".rulesync");
	}
}

describe("BaseToolRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: TestToolRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new TestToolRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should set baseDir from params", () => {
			expect(processor["baseDir"]).toBe(testDir);
		});
	});

	describe("generateAllFromRulesyncRuleFiles", () => {
		it("should throw error when .rulesync directory does not exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			await expect(processor.generateAllFromRulesyncRuleFiles()).rejects.toThrow(
				".rulesync directory does not exist"
			);
		});

		it("should process all rule files in .rulesync directory", async () => {
			const rulesyncDir = join(testDir, ".rulesync");
			const ruleFiles = [
				join(rulesyncDir, "rule1.md"),
				join(rulesyncDir, "rule2.md"),
			];

			vi.mocked(fileExists).mockResolvedValue(true);
			vi.mocked(glob).mockResolvedValue(ruleFiles);

			const mockRulesyncRule = {
				writeFile: vi.fn(),
			};
			const mockToolRule = {
				writeFile: vi.fn(),
			};

			vi.mocked(RulesyncRule.fromFilePath).mockResolvedValue(mockRulesyncRule as any);
			vi.mocked(ToolRule.fromRulesyncRule).mockReturnValue(mockToolRule as any);

			await processor.generateAllFromRulesyncRuleFiles();

			expect(glob).toHaveBeenCalledWith("*.md", {
				cwd: rulesyncDir,
				absolute: true,
			});
			expect(RulesyncRule.fromFilePath).toHaveBeenCalledTimes(2);
			expect(ToolRule.fromRulesyncRule).toHaveBeenCalledTimes(2);
			expect(mockToolRule.writeFile).toHaveBeenCalledTimes(2);
		});
	});

	describe("generateAllToRulesyncRuleFiles", () => {
		it("should create .rulesync directory and process existing rule files", async () => {
			const { mkdir } = await import("node:fs/promises");
			const rulesyncDir = join(testDir, ".rulesync");
			const ruleFilePaths = [
				join(testDir, ".test-rules"),
				join(testDir, "config", "test.md"),
			];

			// Mock first file exists, second doesn't
			vi.mocked(fileExists)
				.mockResolvedValueOnce(true)  // First file exists
				.mockResolvedValueOnce(false); // Second file doesn't exist

			const mockToolRule = {
				toRulesyncRule: vi.fn().mockReturnValue({
					writeFile: vi.fn(),
				}),
			};

			vi.mocked(ToolRule.fromFilePath).mockResolvedValue(mockToolRule as any);

			await processor.generateAllToRulesyncRuleFiles();

			expect(mkdir).toHaveBeenCalledWith(rulesyncDir, { recursive: true });
			expect(ToolRule.fromFilePath).toHaveBeenCalledTimes(1);
			expect(ToolRule.fromFilePath).toHaveBeenCalledWith(ruleFilePaths[0]);
			expect(mockToolRule.toRulesyncRule).toHaveBeenCalledTimes(1);
		});
	});

	describe("validate", () => {
		it("should return error when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const result = await processor.validate();

			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error.message).toBe("No rule files found for TestToolRulesProcessor");
		});

		it("should validate existing rule files successfully", async () => {
			vi.mocked(fileExists)
				.mockResolvedValueOnce(true)  // First file exists
				.mockResolvedValueOnce(false); // Second file doesn't exist

			const mockToolRule = {
				validate: vi.fn().mockReturnValue({ success: true }),
			};

			vi.mocked(ToolRule.fromFilePath).mockResolvedValue(mockToolRule as any);

			const result = await processor.validate();

			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(mockToolRule.validate).toHaveBeenCalledTimes(1);
		});

		it("should collect validation errors from rule files", async () => {
			vi.mocked(fileExists).mockResolvedValue(true);

			const validationError = new Error("Invalid rule format");
			const mockToolRule = {
				validate: vi.fn().mockReturnValue({
					success: false,
					error: validationError,
				}),
			};

			vi.mocked(ToolRule.fromFilePath).mockResolvedValue(mockToolRule as any);

			const result = await processor.validate();

			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(2); // Two files both have errors
			expect(result.errors[0]?.error).toBe(validationError);
		});

		it("should handle errors when loading rule files", async () => {
			vi.mocked(fileExists).mockResolvedValue(true);

			const loadError = new Error("File not readable");
			vi.mocked(ToolRule.fromFilePath).mockRejectedValue(loadError);

			const result = await processor.validate();

			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(2); // Two files both throw errors
			expect(result.errors[0]?.error).toBe(loadError);
		});
	});

	describe("getRulesyncDirectory", () => {
		it("should return .rulesync subdirectory of baseDir", () => {
			const result = processor["getRulesyncDirectory"]();
			expect(result).toBe(join(testDir, ".rulesync"));
		});
	});
});