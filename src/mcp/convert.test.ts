import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { convertTools, executeConvert, type McpConvertResult } from "./convert.js";

describe("MCP Convert Tools", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("executeConvert", () => {
    it("should return error when from is not provided", async () => {
      const result = await executeConvert({ from: "", to: ["cursor"] });

      expect(result.success).toBe(false);
      expect(result.error).toContain("from is required");
    });

    it("should return error when to is empty", async () => {
      const result = await executeConvert({ from: "claudecode", to: [] });

      expect(result.success).toBe(false);
      expect(result.error).toContain("to is required");
    });

    it("should return error when from is an invalid tool name", async () => {
      const result = await executeConvert({ from: "not-a-tool", to: ["cursor"] });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid source tool");
    });

    it("should return error when to contains an invalid tool name", async () => {
      const result = await executeConvert({ from: "claudecode", to: ["not-a-tool"] });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid destination tool");
    });

    it("should return error when to includes the same tool as from", async () => {
      const result = await executeConvert({
        from: "claudecode",
        to: ["claudecode"],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("must not include the source tool");
    });

    it.each([
      { from: "claudecode-plugin", to: ["cursor"] },
      { from: "cursor", to: ["antigravity-plugin"] },
    ])("should reject plugin packaging targets", async (options) => {
      const result = await executeConvert(options);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Plugin packaging target .* is not supported by convert/);
    });

    it("carries a diagnostic back in the result, as convert reads the same files import does", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(
        join(testDir, ".factory", "settings.local.json"),
        JSON.stringify({ commandAllowlist: ["git *"] }),
      );

      const result = await executeConvert({
        from: "factorydroid",
        to: ["cursor"],
        features: ["permissions"],
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([
        expect.stringContaining("settings.local.json is a machine-local overrides file"),
      ]);
    });

    it("omits the warnings key when the conversion had nothing to report", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Claude Code Rules\n");

      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it("should succeed with valid from and to", async () => {
      // Create CLAUDE.md file to convert from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.config?.from).toBe("claudecode");
      expect(result.config?.to).toEqual(["cursor"]);
    });

    it("should return counts in result", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

Body.
`,
      );

      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        rulesCount: expect.any(Number),
        ignoreCount: expect.any(Number),
        mcpCount: expect.any(Number),
        commandsCount: expect.any(Number),
        subagentsCount: expect.any(Number),
        skillsCount: expect.any(Number),
        hooksCount: expect.any(Number),
        permissionsCount: expect.any(Number),
        checksCount: expect.any(Number),
        totalCount: expect.any(Number),
      });
    });

    it("should return config in result", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

Body.
`,
      );

      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.config).toMatchObject({
        from: "claudecode",
        to: ["cursor"],
        features: expect.any(Array),
        global: expect.any(Boolean),
        dryRun: expect.any(Boolean),
      });
    });

    it("should honor dryRun option", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

Body.
`,
      );

      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.config?.dryRun).toBe(true);
    });

    it("should deduplicate to when duplicates are provided", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

Body.
`,
      );

      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor", "cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.config?.to).toEqual(["cursor"]);
    });

    it("should format result as JSON string via convertTools.executeConvert.execute", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

Body.
`,
      );

      const jsonResult = await convertTools.executeConvert.execute({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
      });

      const parsed: McpConvertResult = JSON.parse(jsonResult);
      expect(parsed.success).toBe(true);
    });

    it("should succeed with 0 counts when no source files exist", async () => {
      const result = await executeConvert({
        from: "claudecode",
        to: ["cursor"],
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.result?.totalCount).toBe(0);
    });
  });
});
