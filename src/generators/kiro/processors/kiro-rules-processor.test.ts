import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { KiroRulesProcessor } from "./kiro-rules-processor.js";
import { KiroRule } from "../rules/kiro-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

describe("KiroRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: KiroRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new KiroRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new KiroRulesProcessor instance", () => {
			const instance = KiroRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(KiroRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return KiroRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(KiroRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);
			vi.mocked(glob).mockResolvedValue([]);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include .kiro/steering/*.md files when directory exists", async () => {
			const steeringDir = join(testDir, ".kiro", "steering");
			const steeringFiles = [
				join(steeringDir, "product.md"),
				join(steeringDir, "tech.md"),
				join(steeringDir, "structure.md"),
			];

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === steeringDir;
			});
			vi.mocked(glob).mockResolvedValue(steeringFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(glob).toHaveBeenCalledWith("*.md", {
				cwd: steeringDir,
				absolute: true,
			});
			expect(paths).toEqual(steeringFiles);
		});

		it("should not include files when .kiro/steering directory does not exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
			expect(glob).not.toHaveBeenCalled();
		});

		it("should handle empty .kiro/steering directory", async () => {
			const steeringDir = join(testDir, ".kiro", "steering");

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === steeringDir;
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