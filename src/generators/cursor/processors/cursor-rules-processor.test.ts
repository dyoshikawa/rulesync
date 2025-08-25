import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { CursorRulesProcessor } from "./cursor-rules-processor.js";
import { CursorRule } from "../rules/cursor-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

describe("CursorRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: CursorRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new CursorRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new CursorRulesProcessor instance", () => {
			const instance = CursorRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(CursorRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return CursorRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(CursorRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include .cursorrules file when it exists", async () => {
			const cursorRulesFile = join(testDir, ".cursorrules");
			
			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === cursorRulesFile;
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(cursorRulesFile);
		});

		it("should include .cursor/rules/*.mdc files when directory exists", async () => {
			const cursorRulesDir = join(testDir, ".cursor", "rules");
			const mdcFiles = [
				join(cursorRulesDir, "rule1.mdc"),
				join(cursorRulesDir, "rule2.mdc"),
			];

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === cursorRulesDir;
			});
			vi.mocked(glob).mockResolvedValue(mdcFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(glob).toHaveBeenCalledWith("*.mdc", {
				cwd: cursorRulesDir,
				absolute: true,
			});
			expect(paths).toEqual(expect.arrayContaining(mdcFiles));
		});

		it("should include both .cursorrules and .cursor/rules/*.mdc files when both exist", async () => {
			const cursorRulesFile = join(testDir, ".cursorrules");
			const cursorRulesDir = join(testDir, ".cursor", "rules");
			const mdcFiles = [
				join(cursorRulesDir, "rule1.mdc"),
				join(cursorRulesDir, "rule2.mdc"),
			];

			vi.mocked(fileExists).mockResolvedValue(true);
			vi.mocked(glob).mockResolvedValue(mdcFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(cursorRulesFile);
			expect(paths).toEqual(expect.arrayContaining(mdcFiles));
			expect(paths).toHaveLength(3); // 1 .cursorrules + 2 .mdc files
		});

		it("should not include .cursor/rules/*.mdc files when directory does not exist", async () => {
			const cursorRulesFile = join(testDir, ".cursorrules");
			const cursorRulesDir = join(testDir, ".cursor", "rules");

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === cursorRulesFile; // Only .cursorrules exists
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([cursorRulesFile]);
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