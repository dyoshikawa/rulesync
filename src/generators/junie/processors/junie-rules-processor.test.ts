import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { JunieRulesProcessor } from "./junie-rules-processor.js";
import { JunieRule } from "../rules/junie-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

describe("JunieRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: JunieRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new JunieRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new JunieRulesProcessor instance", () => {
			const instance = JunieRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(JunieRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return JunieRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(JunieRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include .junie/guidelines.md file when it exists", async () => {
			const guidelinesFile = join(testDir, ".junie", "guidelines.md");
			
			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === guidelinesFile;
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(guidelinesFile);
		});

		it("should not include .junie/guidelines.md when it does not exist", async () => {
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