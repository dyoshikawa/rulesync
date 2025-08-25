import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { WindsurfRulesProcessor } from "./windsurf-rules-processor.js";
import { WindsurfRule } from "../rules/windsurf-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

describe("WindsurfRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: WindsurfRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new WindsurfRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new WindsurfRulesProcessor instance", () => {
			const instance = WindsurfRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(WindsurfRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return WindsurfRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(WindsurfRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);
			vi.mocked(glob).mockResolvedValue([]);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include .windsurf-rules file when it exists", async () => {
			const windsurfRulesFile = join(testDir, ".windsurf-rules");
			
			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === windsurfRulesFile;
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(windsurfRulesFile);
		});

		it("should include .windsurf/rules/*.md files when directory exists", async () => {
			const rulesDir = join(testDir, ".windsurf", "rules");
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
			expect(paths).toEqual(expect.arrayContaining(ruleFiles));
		});

		it("should include both .windsurf-rules and .windsurf/rules/*.md files when both exist", async () => {
			const windsurfRulesFile = join(testDir, ".windsurf-rules");
			const rulesDir = join(testDir, ".windsurf", "rules");
			const ruleFiles = [
				join(rulesDir, "rule1.md"),
				join(rulesDir, "rule2.md"),
			];

			vi.mocked(fileExists).mockResolvedValue(true);
			vi.mocked(glob).mockResolvedValue(ruleFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(windsurfRulesFile);
			expect(paths).toEqual(expect.arrayContaining(ruleFiles));
			expect(paths).toHaveLength(3); // 1 .windsurf-rules + 2 rule files
		});

		it("should not include .windsurf/rules/*.md files when directory does not exist", async () => {
			const windsurfRulesFile = join(testDir, ".windsurf-rules");
			const rulesDir = join(testDir, ".windsurf", "rules");

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === windsurfRulesFile; // Only .windsurf-rules exists
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([windsurfRulesFile]);
			expect(glob).not.toHaveBeenCalled();
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