import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { AmazonqcliRulesProcessor } from "./amazonqcli-rules-processor.js";
import { AmazonqcliRule } from "../rules/amazonqcli-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

describe("AmazonqcliRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: AmazonqcliRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new AmazonqcliRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new AmazonqcliRulesProcessor instance", () => {
			const instance = AmazonqcliRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(AmazonqcliRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return AmazonqcliRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(AmazonqcliRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);
			vi.mocked(glob).mockResolvedValue([]);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include .amazonq/rules/*.md files when directory exists", async () => {
			const rulesDir = join(testDir, ".amazonq", "rules");
			const ruleFiles = [
				join(rulesDir, "rule1.md"),
				join(rulesDir, "rule2.md"),
			];

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === rulesDir;
			});
			vi.mocked(glob).mockResolvedValue(ruleFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(glob).toHaveBeenCalledWith("*.md", {
				cwd: rulesDir,
				absolute: true,
			});
			expect(paths).toEqual(ruleFiles);
		});

		it("should not include files when .amazonq/rules directory does not exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
			expect(glob).not.toHaveBeenCalled();
		});

		it("should handle empty .amazonq/rules directory", async () => {
			const rulesDir = join(testDir, ".amazonq", "rules");

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === rulesDir;
			});
			vi.mocked(glob).mockResolvedValue([]);

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