import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { ClineRulesProcessor } from "./cline-rules-processor.js";
import { ClineRule } from "../rules/cline-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

describe("ClineRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: ClineRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new ClineRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new ClineRulesProcessor instance", () => {
			const instance = ClineRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(ClineRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return ClineRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(ClineRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);
			vi.mocked(glob).mockResolvedValue([]);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include .clinerules/*.md files when directory exists", async () => {
			const clineRulesDir = join(testDir, ".clinerules");
			const mdFiles = [
				join(clineRulesDir, "rule1.md"),
				join(clineRulesDir, "rule2.md"),
			];

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === clineRulesDir;
			});
			vi.mocked(glob).mockResolvedValue(mdFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(glob).toHaveBeenCalledWith("*.md", {
				cwd: clineRulesDir,
				absolute: true,
			});
			expect(paths).toEqual(mdFiles);
		});

		it("should not include files when .clinerules directory does not exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
			expect(glob).not.toHaveBeenCalled();
		});

		it("should handle empty .clinerules directory", async () => {
			const clineRulesDir = join(testDir, ".clinerules");

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === clineRulesDir;
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