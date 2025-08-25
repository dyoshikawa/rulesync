import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { ClaudecodeRulesProcessor } from "./claudecode-rules-processor.js";
import { ClaudecodeRule } from "../rules/claudecode-rule.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import glob from "fast-glob";

vi.mock("../../../utils/file-utils.js", () => ({
	fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
	default: vi.fn(),
}));

describe("ClaudecodeRulesProcessor", () => {
	let testDir: string;
	let cleanup: () => Promise<void>;
	let processor: ClaudecodeRulesProcessor;

	beforeEach(async () => {
		({ testDir, cleanup } = await setupTestDirectory());
		vi.clearAllMocks();
		
		processor = new ClaudecodeRulesProcessor({ baseDir: testDir });
	});

	afterEach(async () => {
		await cleanup();
		vi.restoreAllMocks();
	});

	describe("build", () => {
		it("should create a new ClaudecodeRulesProcessor instance", () => {
			const instance = ClaudecodeRulesProcessor.build({ baseDir: testDir });
			expect(instance).toBeInstanceOf(ClaudecodeRulesProcessor);
		});
	});

	describe("getRuleClass", () => {
		it("should return ClaudecodeRule class", () => {
			const RuleClass = processor["getRuleClass"]();
			expect(RuleClass).toBe(ClaudecodeRule);
		});
	});

	describe("getRuleFilePaths", () => {
		it("should return empty array when no rule files exist", async () => {
			vi.mocked(fileExists).mockResolvedValue(false);
			vi.mocked(glob).mockResolvedValue([]);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([]);
		});

		it("should include CLAUDE.md file when it exists", async () => {
			const claudeFile = join(testDir, "CLAUDE.md");
			
			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === claudeFile;
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(claudeFile);
		});

		it("should include .claude/memories/*.md files when directory exists", async () => {
			const memoriesDir = join(testDir, ".claude", "memories");
			const memoryFiles = [
				join(memoriesDir, "memory1.md"),
				join(memoriesDir, "memory2.md"),
			];

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === memoriesDir;
			});
			vi.mocked(glob).mockResolvedValue(memoryFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(glob).toHaveBeenCalledWith("*.md", {
				cwd: memoriesDir,
				absolute: true,
			});
			expect(paths).toEqual(expect.arrayContaining(memoryFiles));
		});

		it("should include both CLAUDE.md and .claude/memories/*.md files when both exist", async () => {
			const claudeFile = join(testDir, "CLAUDE.md");
			const memoriesDir = join(testDir, ".claude", "memories");
			const memoryFiles = [
				join(memoriesDir, "memory1.md"),
				join(memoriesDir, "memory2.md"),
			];

			vi.mocked(fileExists).mockResolvedValue(true);
			vi.mocked(glob).mockResolvedValue(memoryFiles);

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toContain(claudeFile);
			expect(paths).toEqual(expect.arrayContaining(memoryFiles));
			expect(paths).toHaveLength(3); // 1 CLAUDE.md + 2 memory files
		});

		it("should not include .claude/memories/*.md files when directory does not exist", async () => {
			const claudeFile = join(testDir, "CLAUDE.md");
			const memoriesDir = join(testDir, ".claude", "memories");

			vi.mocked(fileExists).mockImplementation(async (path: string) => {
				return path === claudeFile; // Only CLAUDE.md exists
			});

			const paths = await processor["getRuleFilePaths"]();

			expect(paths).toEqual([claudeFile]);
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