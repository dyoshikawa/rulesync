import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncCheck } from "./rulesync-check.js";
import { TaktCheck } from "./takt-check.js";

function rulesyncCheck({
  name,
  body = "",
  frontmatter = {},
}: {
  name: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
}): RulesyncCheck {
  return new RulesyncCheck({
    outputRoot: ".",
    relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
    relativeFilePath: `${name}.md`,
    frontmatter: { targets: ["*"], ...frontmatter },
    body,
  });
}

function workflowOverridesOf(yamlContent: string): Record<string, unknown> {
  const parsed = load(yamlContent);
  if (!isRecord(parsed)) return {};
  return isRecord(parsed.workflow_overrides) ? parsed.workflow_overrides : {};
}

describe("TaktCheck", () => {
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

  async function generate(checks: RulesyncCheck[]): Promise<string> {
    const [toolCheck] = await TaktCheck.fromRulesyncChecks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      rulesyncChecks: checks,
    });
    if (!toolCheck) throw new Error("expected one config file");
    return toolCheck.getFileContent();
  }

  describe("getSettablePaths", () => {
    it("targets the shared .takt directory", () => {
      expect(TaktCheck.getSettablePaths().relativeDirPath).toBe(".takt");
    });
  });

  it("is never deletable, since config.yaml holds the rest of Takt's settings", () => {
    const check = new TaktCheck({
      outputRoot: testDir,
      relativeDirPath: ".takt",
      relativeFilePath: "config.yaml",
      fileContent: "",
      validate: false,
    });
    expect(check.isDeletable()).toBe(false);
  });

  describe("fromRulesyncChecks", () => {
    it("writes a check body as a string gate", async () => {
      const content = await generate([
        rulesyncCheck({ name: "tests", body: "All tests pass.\n" }),
        rulesyncCheck({ name: "docs", body: "Docs updated." }),
      ]);

      expect(workflowOverridesOf(content).quality_gates).toEqual([
        "All tests pass.",
        "Docs updated.",
      ]);
    });

    it("falls back to the description, then the file stem, for an empty body", async () => {
      const content = await generate([
        rulesyncCheck({ name: "described", frontmatter: { description: "No secrets committed" } }),
        rulesyncCheck({ name: "bare" }),
      ]);

      expect(workflowOverridesOf(content).quality_gates).toEqual(["No secrets committed", "bare"]);
    });

    it("writes a command gate when the takt block names a command", async () => {
      const content = await generate([
        rulesyncCheck({
          name: "quality-check",
          body: "ignored for a command gate",
          frontmatter: {
            takt: { command: "./.takt/quality-gates/check.sh", cwd: ".", timeout_ms: 300000 },
          },
        }),
      ]);

      expect(workflowOverridesOf(content).quality_gates).toEqual([
        {
          type: "command",
          // Named from the file stem, so Takt's logs identify the gate.
          name: "quality-check",
          command: "./.takt/quality-gates/check.sh",
          cwd: ".",
          timeout_ms: 300000,
        },
      ]);
    });

    it("scopes a gate to the named steps and personas", async () => {
      const content = await generate([
        rulesyncCheck({
          name: "security",
          body: "No security vulnerabilities.",
          frontmatter: { takt: { steps: ["review"], personas: ["coder"] } },
        }),
        rulesyncCheck({ name: "everywhere", body: "Everything builds." }),
      ]);

      const overrides = workflowOverridesOf(content);
      expect(overrides.quality_gates).toEqual(["Everything builds."]);
      expect(overrides.steps).toEqual({
        review: { quality_gates: ["No security vulnerabilities."] },
      });
      expect(overrides.personas).toEqual({
        coder: { quality_gates: ["No security vulnerabilities."] },
      });
    });

    it("turns on quality_gates_edit_only when any check asks for it", async () => {
      const content = await generate([
        rulesyncCheck({ name: "a", body: "A." }),
        rulesyncCheck({
          name: "b",
          body: "B.",
          frontmatter: { takt: { quality_gates_edit_only: true } },
        }),
      ]);

      expect(workflowOverridesOf(content).quality_gates_edit_only).toBe(true);
    });

    it("rejects a takt block Takt itself would refuse", async () => {
      await expect(
        generate([rulesyncCheck({ name: "bad", frontmatter: { takt: { command: "" } } })]),
      ).rejects.toThrow(/Invalid `takt` block/);
    });

    it("preserves every other key of config.yaml and replaces the owned block", async () => {
      const dirPath = join(testDir, ".takt");
      await ensureDir(dirPath);
      await writeFileContent(
        join(dirPath, "config.yaml"),
        [
          "provider: claude",
          "workflow_mcp_servers:",
          "  stdio: true",
          "workflow_overrides:",
          "  quality_gates:",
          '    - "A gate a previous generate wrote"',
          "",
        ].join("\n"),
      );

      const content = await generate([rulesyncCheck({ name: "only", body: "The only gate." })]);
      const parsed = load(content);
      if (!isRecord(parsed)) throw new Error("expected object");

      expect(parsed.provider).toBe("claude");
      expect(parsed.workflow_mcp_servers).toEqual({ stdio: true });
      // Owned block: the stale gate is gone rather than merged with the new one.
      expect(workflowOverridesOf(content).quality_gates).toEqual(["The only gate."]);
    });

    it("writes an empty block when no check targets Takt", async () => {
      const content = await generate([]);

      expect(workflowOverridesOf(content)).toEqual({});
    });
  });

  describe("toRulesyncChecks", () => {
    function imported(yamlContent: string): RulesyncCheck[] {
      return new TaktCheck({
        outputRoot: testDir,
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
        fileContent: yamlContent,
      }).toRulesyncChecks();
    }

    it("splits the block into one check per gate", async () => {
      const checks = imported(
        [
          "workflow_overrides:",
          "  quality_gates:",
          '    - "All tests pass"',
          "    - type: command",
          "      name: quality-check",
          '      command: "./check.sh"',
          "  steps:",
          "    review:",
          "      quality_gates:",
          '        - "No security vulnerabilities"',
          "",
        ].join("\n"),
      );

      expect(checks.map((check) => check.getRelativeFilePath())).toEqual([
        "all-tests-pass-1.md",
        "quality-check-2.md",
        "review-no-security-vulnerabilities-3.md",
      ]);
      expect(checks[0]?.getBody()).toBe("All tests pass");
      expect(checks[1]?.getFrontmatter().takt).toEqual({
        name: "quality-check",
        command: "./check.sh",
      });
      expect(checks[2]?.getFrontmatter().takt).toEqual({ steps: ["review"] });
    });

    it("returns nothing for a config with no overrides block", () => {
      expect(imported("provider: claude\n")).toEqual([]);
    });

    it("skips a gate whose shape Takt would not accept", () => {
      const checks = imported(
        ["workflow_overrides:", "  quality_gates:", "    - type: unknown", "      x: 1", ""].join(
          "\n",
        ),
      );

      expect(checks).toEqual([]);
    });

    it("round-trips a generated block back to the same gates", async () => {
      const content = await generate([
        rulesyncCheck({ name: "tests", body: "All tests pass." }),
        rulesyncCheck({
          name: "gate",
          frontmatter: { takt: { command: "./check.sh", steps: ["review"] } },
        }),
      ]);

      const checks = imported(content);
      expect(checks[0]?.getBody()).toBe("All tests pass.");
      expect(checks[1]?.getFrontmatter().takt).toEqual({
        name: "gate",
        command: "./check.sh",
        steps: ["review"],
      });
    });
  });
});
