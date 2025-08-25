import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { QwencodeRulesProcessor } from "./qwencode-rules-processor.js";
import { QwencodeRule } from "../rules/qwencode-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

describe("QwencodeRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: QwencodeRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new QwencodeRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new QwencodeRulesProcessor instance", () => {
			const instance = QwencodeRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(QwencodeRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return QwencodeRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(QwencodeRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include QWEN.md file when it exists", async () => {
			const qwenFile = join(testDir, "QWEN.md");
			
			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === qwenFile;
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(qwenFile);
		});

		it("should not include QWEN.md when it does not exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});
	});

	describe("validate", () => {
		it("should inherit validation from BaseToolRulesProcessor", async () => {
			// This test ensures the processor properly extends BaseToolRulesProcessor
			// and inherits its validation behavior
			vi.mocked(fileExists).mockResolvedValue(false);

			const result = await processor.validate();

			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error.message).toContain("No rule files found");
		});
	});
});