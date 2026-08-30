import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CONFIG_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { executeImport, type McpImportResult } from "./import.js";

const { getHomeDirectoryMock } = vi.hoisted(() => {
  return {
    getHomeDirectoryMock: vi.fn(),
  };
});

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    getHomeDirectory: getHomeDirectoryMock,
  };
});

describe("MCP Import Tools", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    getHomeDirectoryMock.mockClear();
  });

  describe("executeImport", () => {
    it("should return error when target is not provided", async () => {
      const result = await executeImport({ target: "" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("target is required");
    });

    it("should execute import with specified target", async () => {
      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await executeImport({
        target: "claudecode",
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.config?.target).toBe("claudecode");
      expect(result.config?.features).toContain("rules");
    });

    it("should use rulesync.jsonc settings when no features provided", async () => {
      // Create rulesync.jsonc with specific settings
      await writeFileContent(
        join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
        JSON.stringify({
          features: ["rules", "ignore"],
        }),
      );

      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await executeImport({
        target: "claudecode",
      });

      expect(result.success).toBe(true);
      expect(result.config?.features).toContain("rules");
    });

    it("should override config with MCP options", async () => {
      // Create rulesync.jsonc with default settings
      await writeFileContent(
        join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
        JSON.stringify({
          features: ["rules"],
        }),
      );

      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      // Override with MCP options
      const result = await executeImport({
        target: "claudecode",
        features: ["rules", "ignore", "mcp"],
      });

      expect(result.success).toBe(true);
      expect(result.config?.features).toContain("rules");
      expect(result.config?.features).toContain("ignore");
      expect(result.config?.features).toContain("mcp");
    });

    it("carries a diagnostic back in the result, since MCP has no console to write it to", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(
        join(testDir, ".factory", "settings.local.json"),
        JSON.stringify({ commandAllowlist: ["git *"] }),
      );

      const result = await executeImport({
        target: "factorydroid",
        features: ["permissions"],
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([
        expect.stringContaining("settings.local.json is a machine-local overrides file"),
      ]);
    });

    it("reports the same diagnostic to a later call, since each call is its own run", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(
        join(testDir, ".factory", "settings.local.json"),
        JSON.stringify({ commandAllowlist: ["git *"] }),
      );

      await executeImport({ target: "factorydroid", features: ["permissions"] });
      const second = await executeImport({ target: "factorydroid", features: ["permissions"] });

      // Asserted positively: a once-per-run warning that the first call had
      // spent for the whole process would leave this empty rather than equal.
      expect(second.warnings).toEqual([
        expect.stringContaining("settings.local.json is a machine-local overrides file"),
      ]);
    });

    it("still reports the warnings when the import fails part-way through", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(
        join(testDir, ".factory", "settings.local.json"),
        JSON.stringify({ commandAllowlist: ["git *"] }),
      );
      // A file where the output directory has to go: the read (and its
      // warning) succeeds, the write that follows cannot.
      await writeFileContent(join(testDir, ".rulesync"), "not a directory");

      const result = await executeImport({
        target: "factorydroid",
        features: ["permissions"],
      });

      expect(result.success).toBe(false);
      expect(result.warnings).toEqual([
        expect.stringContaining("settings.local.json is a machine-local overrides file"),
      ]);
    });

    it("reports a warning raised where no logger was threaded through", async () => {
      // `ConfigResolver` warns through the shared fallback rather than through
      // a logger the caller handed it, and it runs before the import proper. A
      // scope that started later would leave this one on a stderr the calling
      // agent never sees, and the missing `warnings` key would read as
      // "nothing was wrong" about an output scope that silently changed.
      await writeFileContent(
        join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
        JSON.stringify({ global: true, inputRoot: "." }),
      );
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Claude Code Rules\n");

      const result = await executeImport({ target: "claudecode", features: ["rules"] });

      expect(result.warnings).toEqual([expect.stringContaining('Ignoring "global: true"')]);
    });

    it("omits the warnings key when the import had nothing to report", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Claude Code Rules\n");

      const result = await executeImport({ target: "claudecode", features: ["rules"] });

      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it("should return import counts in result", async () => {
      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await executeImport({
        target: "claudecode",
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
      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await executeImport({
        target: "claudecode",
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.config).toMatchObject({
        target: "claudecode",
        features: expect.any(Array),
        global: expect.any(Boolean),
      });
    });

    it("should format result as JSON string", async () => {
      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      // Import the tools to test JSON formatting
      const { importTools } = await import("./import.js");
      const jsonResult = await importTools.executeImport.execute({
        target: "claudecode",
        features: ["rules"],
      });

      // Should be valid JSON
      const parsed: McpImportResult = JSON.parse(jsonResult);
      expect(parsed.success).toBe(true);
    });

    it("should handle import with no files to import", async () => {
      // Don't create any files, import should still succeed with 0 counts
      const result = await executeImport({
        target: "claudecode",
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.result?.totalCount).toBe(0);
    });

    it("should handle cursor import", async () => {
      // Create .cursorrules file to import from
      await writeFileContent(
        join(testDir, ".cursorrules"),
        `# Cursor Rules

This is a test cursor rule file.
`,
      );

      const result = await executeImport({
        target: "cursor",
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.config?.target).toBe("cursor");
    });

    it("should handle copilot import", async () => {
      // Create .github/copilot-instructions.md file to import from
      await ensureDir(join(testDir, ".github"));
      await writeFileContent(
        join(testDir, ".github/copilot-instructions.md"),
        `# Copilot Instructions

This is a test copilot instructions file.
`,
      );

      const result = await executeImport({
        target: "copilot",
        features: ["rules"],
      });

      expect(result.success).toBe(true);
      expect(result.config?.target).toBe("copilot");
    });

    it("should handle unsupported target gracefully", async () => {
      // Note: Invalid targets don't cause errors - they simply result in 0 files imported
      // because the target is not in the supported targets list for any feature processor
      const result = await executeImport({
        target: "agentsmd", // agentsmd is a valid target but doesn't have files to import
        features: ["rules"],
      });

      // Should succeed but with 0 files imported
      expect(result.success).toBe(true);
      expect(result.result?.totalCount).toBe(0);
    });

    it("should handle wildcard features", async () => {
      // Create CLAUDE.md file to import from
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Rules

This is a test rule file.
`,
      );

      const result = await executeImport({
        target: "claudecode",
        features: ["*"],
      });

      expect(result.success).toBe(true);
      // Wildcard should expand to multiple features
      expect(result.config?.features.length).toBeGreaterThan(1);
    });
  });

  describe("executeImport with global mode", () => {
    let homeDir: string;
    let homeCleanup: () => Promise<void>;

    beforeEach(async () => {
      // Setup separate home directory for global mode tests
      const homeSetup = await setupTestDirectory({ home: true });
      homeDir = homeSetup.testDir;
      homeCleanup = homeSetup.cleanup;
      getHomeDirectoryMock.mockReturnValue(homeDir);
    });

    afterEach(async () => {
      await homeCleanup();
    });

    it("should import with global mode enabled", async () => {
      // Create global CLAUDE.md file at ~/.claude/CLAUDE.md
      const claudeDir = join(homeDir, ".claude");
      await ensureDir(claudeDir);
      await writeFileContent(
        join(claudeDir, "CLAUDE.md"),
        `# Global Claude Rules

This is a global rule file.
`,
      );

      const result = await executeImport({
        target: "claudecode",
        features: ["rules"],
        global: true,
      });

      expect(result.success).toBe(true);
      expect(result.config?.global).toBe(true);
    });

    it("should return global: true in config when global option is set", async () => {
      const result = await executeImport({
        target: "claudecode",
        features: ["rules"],
        global: true,
      });

      expect(result.success).toBe(true);
      expect(result.config?.global).toBe(true);
    });

    it("should return global: false in config when global option is not set", async () => {
      const result = await executeImport({
        target: "claudecode",
        features: ["rules"],
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.config?.global).toBe(false);
    });
  });
});
