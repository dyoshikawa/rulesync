import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { GeminicliRulesProcessor } from "./geminicli-rules-processor.js";
import { GeminicliRule } from "../rules/geminicli-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

describe("GeminicliRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: GeminicliRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new GeminicliRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new GeminicliRulesProcessor instance", () => {
			const instance = GeminicliRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(GeminicliRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return GeminicliRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(GeminicliRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include GEMINI.md file when it exists", async () => {
			const geminiFile = join(testDir, "GEMINI.md");
			
			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === geminiFile;
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(geminiFile);
		});

		it("should not include GEMINI.md when it does not exist", async () => {
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