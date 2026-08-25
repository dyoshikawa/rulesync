import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_CHECKS_RELATIVE_DIR_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate } from "./e2e-helper.js";

const originalCwd = process.cwd();

// This suite verifies that `--input-roots` correctly redirects the source
// root(s) for each feature end-to-end. The Tool × Feature matrix itself is
// preserved by the project-wide e2e suites (e.g. `e2e-rules.spec.ts` and
// the per-tool feature suites) and by the unit-level coverage in each
// processor's tests (e.g. `src/features/<feature>/<feature>-processor.test.ts`,
// which exercise `inputRoots` threading per tool). The per-feature blocks
// below intentionally use a single representative tool per feature: the
// goal here is to confirm the `--input-roots` plumbing reaches each
// feature's processor — not to re-walk the matrix. The rules block above
// does iterate across multiple tools because rule output paths vary most
// across tools.
describe("E2E: --input-roots (read from A, write to B)", () => {
  let sourceDir = "";
  let sourceRoot = "";
  let outputDir = "";
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupSource: () => Promise<void> = async () => {};
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupOutput: () => Promise<void> = async () => {};

  beforeEach(async () => {
    ({ testDir: sourceDir, cleanup: cleanupSource } = await setupTestDirectory());
    ({ testDir: outputDir, cleanup: cleanupOutput } = await setupTestDirectory());
    sourceRoot = join(sourceDir, RULESYNC_RELATIVE_DIR_PATH);
    process.chdir(outputDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupSource();
    await cleanupOutput();
  });

  it.each([
    { target: "claudecode", outputPath: "CLAUDE.md" },
    { target: "cursor", outputPath: join(".cursor", "rules", "overview.mdc") },
    { target: "codexcli", outputPath: "AGENTS.md" },
  ])(
    "should read rules from --input-roots and write $target output to cwd",
    async ({ target, outputPath }) => {
      const ruleContent = `---
root: true
targets: ["*"]
description: "Input-root test rule"
globs: ["**/*"]
---

# Input Root Test Rule

Rules live in sourceDir; output must land in outputDir.
`;
      await writeFileContent(
        join(sourceDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
        ruleContent,
      );

      await runGenerate({ target, features: "rules", inputRoots: [sourceRoot] });

      const generatedContent = await readFileContent(join(outputDir, outputPath));
      expect(generatedContent).toContain("Input Root Test Rule");

      expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
    },
  );

  it("should preserve --input-root parent-directory compatibility", async () => {
    await writeFileContent(
      join(sourceDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      `---
root: true
targets: ["*"]
---
# Singular Input Root`,
    );

    await runGenerate({ target: "codexcli", features: "rules", inputRoot: sourceDir });

    const generatedContent = await readFileContent(join(outputDir, "AGENTS.md"));
    expect(generatedContent).toContain("Singular Input Root");
  });

  // Per-feature smoke tests below: each one picks a single representative
  // tool. See suite-level comment — matrix-wide coverage lives elsewhere.

  it("should read commands from --input-roots and write claudecode output to cwd", async () => {
    const commandContent = `---
description: "Review a pull request"
targets: ["*"]
---
Check the PR diff and provide feedback.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      commandContent,
    );

    await runGenerate({ target: "claudecode", features: "commands", inputRoots: [sourceRoot] });

    const outputPath = join(".claude", "commands", "review-pr.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read mcp from --input-roots and write claudecode output to cwd", async () => {
    const mcpContent = JSON.stringify(
      {
        mcpServers: {
          "input-root-server": {
            type: "stdio",
            command: "echo",
            args: ["hi"],
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(sourceDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

    await runGenerate({ target: "claudecode", features: "mcp", inputRoots: [sourceRoot] });

    const outputPath = ".mcp.json";
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("input-root-server");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read ignore from --input-roots and write cursor output to cwd", async () => {
    const ignoreContent = `tmp/
secrets/
*.env
`;
    await writeFileContent(join(sourceDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH), ignoreContent);

    await runGenerate({ target: "cursor", features: "ignore", inputRoots: [sourceRoot] });

    const outputPath = ".cursorignore";
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("tmp/");
    expect(generatedContent).toContain("secrets/");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read hooks from --input-roots and write claudecode output to cwd", async () => {
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(sourceDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "claudecode", features: "hooks", inputRoots: [sourceRoot] });

    const outputPath = join(".claude", "settings.json");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    const parsed = JSON.parse(generatedContent);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.SessionStart).toBeDefined();
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read permissions from --input-roots and write opencode output to cwd", async () => {
    const permissionsContent = JSON.stringify(
      {
        permission: {
          bash: { "git *": "allow", "rm -rf": "deny" },
        },
      },
      null,
      2,
    );
    await writeFileContent(
      join(sourceDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      permissionsContent,
    );

    await runGenerate({ target: "opencode", features: "permissions", inputRoots: [sourceRoot] });

    const outputPath = "opencode.jsonc";
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    const parsed = JSON.parse(generatedContent);
    expect(parsed.permission.bash["git *"]).toBe("allow");
    expect(parsed.permission.bash["rm -rf"]).toBe("deny");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read subagents from --input-roots and write claudecode output to cwd", async () => {
    const subagentContent = `---
name: planner
targets: ["*"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      subagentContent,
    );

    await runGenerate({ target: "claudecode", features: "subagents", inputRoots: [sourceRoot] });

    const outputPath = join(".claude", "agents", "planner.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("You are the planner");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read skills from --input-roots and write claudecode output to cwd", async () => {
    const skillContent = `---
name: test-skill
description: "An input-root test skill"
targets: ["*"]
---
Body content for the input-root skill.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
      skillContent,
    );

    await runGenerate({ target: "claudecode", features: "skills", inputRoots: [sourceRoot] });

    const outputPath = join(".claude", "skills", "test-skill", "SKILL.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("Body content for the input-root skill.");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read checks from --input-roots and write amp output to cwd", async () => {
    const checkContent = `---
targets: ["*"]
description: "Flags security issues"
severity: high
---
Look for injection vulnerabilities.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
      checkContent,
    );

    await runGenerate({ target: "amp", features: "checks", inputRoots: [sourceRoot] });

    const outputPath = join(".agents", "checks", "security.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("Look for injection vulnerabilities.");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });
});

// Two-root overlay coverage — verifies the plumbed merge policies per feature:
//   - Glob-based features (rules, commands, subagents, checks, skills):
//     last-wins-by-relative-path — an overlay root replaces a base file with
//     the same relative path, and unique entries from either root survive.
//   - Single-file features (hooks, permissions, ignore): the last root that
//     contains the file wins entirely — no per-key merging.
//   - MCP: one-level deep merge under `mcpServers` — later servers win, base
//     servers not present in the overlay survive.
describe("E2E: --input-roots (two-root overlay)", () => {
  let baseDir = "";
  let baseRoot = "";
  let overlayDir = "";
  let overlayRoot = "";
  let outputDir = "";
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupBase: () => Promise<void> = async () => {};
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupOverlay: () => Promise<void> = async () => {};
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupOutput: () => Promise<void> = async () => {};

  beforeEach(async () => {
    ({ testDir: baseDir, cleanup: cleanupBase } = await setupTestDirectory());
    ({ testDir: overlayDir, cleanup: cleanupOverlay } = await setupTestDirectory());
    ({ testDir: outputDir, cleanup: cleanupOutput } = await setupTestDirectory());
    baseRoot = join(baseDir, RULESYNC_RELATIVE_DIR_PATH);
    overlayRoot = join(overlayDir, RULESYNC_RELATIVE_DIR_PATH);
    process.chdir(outputDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupBase();
    await cleanupOverlay();
    await cleanupOutput();
  });

  it("allows the optional overlay root to be absent", async () => {
    await writeFileContent(
      join(baseDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      `---
root: true
targets: ["*"]
---
# Base Without Local Overlay`,
    );

    await runGenerate({
      target: "codexcli",
      features: "rules",
      inputRoots: [baseRoot, overlayRoot],
    });

    const generatedContent = await readFileContent(join(outputDir, "AGENTS.md"));
    expect(generatedContent).toContain("Base Without Local Overlay");
    expect(await fileExists(overlayRoot)).toBe(false);
  });

  it("rules: last root wins for same relative path, unique files from each root survive", async () => {
    const baseOverview = `---
root: true
targets: ["*"]
description: "Base overview"
globs: ["**/*"]
---

# Base Overview
Base rule body.
`;
    const overlayOverview = `---
root: true
targets: ["*"]
description: "Overlay overview"
globs: ["**/*"]
---

# Overlay Overview
Overlay rule body.
`;
    const overlayOnlyRule = `---
root: false
targets: ["*"]
description: "Overlay-only rule"
globs: ["**/*"]
---

# Overlay Only
Overlay-only rule body.
`;

    await writeFileContent(
      join(baseDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      baseOverview,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      overlayOverview,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "overlay-only.md"),
      overlayOnlyRule,
    );

    await runGenerate({
      target: "cursor",
      features: "rules",
      inputRoots: [baseRoot, overlayRoot],
    });

    const overview = await readFileContent(join(outputDir, ".cursor", "rules", "overview.mdc"));
    expect(overview).toContain("Overlay Overview");
    expect(overview).not.toContain("Base Overview");

    const overlayOnly = await readFileContent(
      join(outputDir, ".cursor", "rules", "overlay-only.mdc"),
    );
    expect(overlayOnly).toContain("Overlay Only");
  });

  it("commands: last root wins for same relative path, unique commands from each root survive", async () => {
    const baseReview = `---
description: "base review"
targets: ["*"]
---
BASE review body.
`;
    const overlayReview = `---
description: "overlay review"
targets: ["*"]
---
OVERLAY review body.
`;
    const baseOnly = `---
description: "base only"
targets: ["*"]
---
BASE-ONLY body.
`;

    await writeFileContent(
      join(baseDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md"),
      baseReview,
    );
    await writeFileContent(
      join(baseDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "base-only.md"),
      baseOnly,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md"),
      overlayReview,
    );

    await runGenerate({
      target: "claudecode",
      features: "commands",
      inputRoots: [baseRoot, overlayRoot],
    });

    const review = await readFileContent(join(outputDir, ".claude", "commands", "review.md"));
    expect(review).toContain("OVERLAY review body.");
    expect(review).not.toContain("BASE review body.");

    const baseOnlyOut = await readFileContent(
      join(outputDir, ".claude", "commands", "base-only.md"),
    );
    expect(baseOnlyOut).toContain("BASE-ONLY body.");
  });

  it("subagents: last root wins for same relative path, unique subagents from each root survive", async () => {
    const basePlanner = `---
name: planner
targets: ["*"]
description: "base planner"
---
BASE planner body.
`;
    const overlayPlanner = `---
name: planner
targets: ["*"]
description: "overlay planner"
---
OVERLAY planner body.
`;
    const overlayReviewer = `---
name: reviewer
targets: ["*"]
description: "overlay reviewer"
---
OVERLAY reviewer body.
`;

    await writeFileContent(
      join(baseDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      basePlanner,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      overlayPlanner,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md"),
      overlayReviewer,
    );

    await runGenerate({
      target: "claudecode",
      features: "subagents",
      inputRoots: [baseRoot, overlayRoot],
    });

    const planner = await readFileContent(join(outputDir, ".claude", "agents", "planner.md"));
    expect(planner).toContain("OVERLAY planner body.");
    expect(planner).not.toContain("BASE planner body.");

    const reviewer = await readFileContent(join(outputDir, ".claude", "agents", "reviewer.md"));
    expect(reviewer).toContain("OVERLAY reviewer body.");
  });

  it("skills: last root wins for same relative path, unique skills from each root survive", async () => {
    const baseSkill = `---
name: shared-skill
description: "base skill"
targets: ["*"]
---
BASE skill body.
`;
    const overlaySkill = `---
name: shared-skill
description: "overlay skill"
targets: ["*"]
---
OVERLAY skill body.
`;
    const overlayOnly = `---
name: overlay-only-skill
description: "overlay-only skill"
targets: ["*"]
---
OVERLAY-ONLY skill body.
`;

    await writeFileContent(
      join(baseDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "shared-skill", "SKILL.md"),
      baseSkill,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "shared-skill", "SKILL.md"),
      overlaySkill,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "overlay-only-skill", "SKILL.md"),
      overlayOnly,
    );

    await runGenerate({
      target: "claudecode",
      features: "skills",
      inputRoots: [baseRoot, overlayRoot],
    });

    const shared = await readFileContent(
      join(outputDir, ".claude", "skills", "shared-skill", "SKILL.md"),
    );
    expect(shared).toContain("OVERLAY skill body.");
    expect(shared).not.toContain("BASE skill body.");

    const overlayOnlyOut = await readFileContent(
      join(outputDir, ".claude", "skills", "overlay-only-skill", "SKILL.md"),
    );
    expect(overlayOnlyOut).toContain("OVERLAY-ONLY skill body.");
  });

  it("checks: last root wins for same relative path, unique checks from each root survive", async () => {
    const baseSecurity = `---
targets: ["*"]
description: "base security check"
severity: high
---
BASE security check body.
`;
    const overlaySecurity = `---
targets: ["*"]
description: "overlay security check"
severity: high
---
OVERLAY security check body.
`;
    const overlayStyle = `---
targets: ["*"]
description: "overlay style check"
severity: low
---
OVERLAY style check body.
`;

    await writeFileContent(
      join(baseDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
      baseSecurity,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
      overlaySecurity,
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "style.md"),
      overlayStyle,
    );

    await runGenerate({
      target: "amp",
      features: "checks",
      inputRoots: [baseRoot, overlayRoot],
    });

    const security = await readFileContent(join(outputDir, ".agents", "checks", "security.md"));
    expect(security).toContain("OVERLAY security check body.");
    expect(security).not.toContain("BASE security check body.");

    const style = await readFileContent(join(outputDir, ".agents", "checks", "style.md"));
    expect(style).toContain("OVERLAY style check body.");
  });

  it("ignore: later root fully replaces earlier root's file", async () => {
    await writeFileContent(
      join(baseDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
      "base-only-dir/\nshared/\n",
    );
    await writeFileContent(
      join(overlayDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
      "overlay-only-dir/\nshared/\n",
    );

    await runGenerate({
      target: "cursor",
      features: "ignore",
      inputRoots: [baseRoot, overlayRoot],
    });

    const out = await readFileContent(join(outputDir, ".cursorignore"));
    expect(out).toContain("overlay-only-dir/");
    expect(out).toContain("shared/");
    expect(out).not.toContain("base-only-dir/");
  });

  it("hooks: later root fully replaces earlier root's file", async () => {
    const baseHooks = JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/base.sh" }],
        },
      },
      null,
      2,
    );
    const overlayHooks = JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/overlay.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(baseDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), baseHooks);
    await writeFileContent(join(overlayDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), overlayHooks);

    await runGenerate({
      target: "claudecode",
      features: "hooks",
      inputRoots: [baseRoot, overlayRoot],
    });

    const parsed = JSON.parse(await readFileContent(join(outputDir, ".claude", "settings.json")));
    const serialized = JSON.stringify(parsed);
    expect(serialized).toContain("overlay.sh");
    expect(serialized).not.toContain("base.sh");
  });

  it("permissions: later root fully replaces earlier root's file", async () => {
    const basePermissions = JSON.stringify(
      {
        permission: {
          bash: { "git *": "allow", "base-only": "deny" },
        },
      },
      null,
      2,
    );
    const overlayPermissions = JSON.stringify(
      {
        permission: {
          bash: { "git *": "deny", "overlay-only": "allow" },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(baseDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH), basePermissions);
    await writeFileContent(
      join(overlayDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      overlayPermissions,
    );

    await runGenerate({
      target: "opencode",
      features: "permissions",
      inputRoots: [baseRoot, overlayRoot],
    });

    const parsed = JSON.parse(await readFileContent(join(outputDir, "opencode.jsonc")));
    expect(parsed.permission.bash["git *"]).toBe("deny");
    expect(parsed.permission.bash["overlay-only"]).toBe("allow");
    expect(parsed.permission.bash["base-only"]).toBeUndefined();
  });

  it("mcp: deep-merges `mcpServers` — later servers win, base-only servers survive", async () => {
    const baseMcp = JSON.stringify(
      {
        mcpServers: {
          shared: { type: "stdio", command: "base-cmd" },
          "base-only": { type: "stdio", command: "base-only-cmd" },
        },
      },
      null,
      2,
    );
    const overlayMcp = JSON.stringify(
      {
        mcpServers: {
          shared: { type: "stdio", command: "overlay-cmd" },
          "overlay-only": { type: "stdio", command: "overlay-only-cmd" },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(baseDir, RULESYNC_MCP_RELATIVE_FILE_PATH), baseMcp);
    await writeFileContent(join(overlayDir, RULESYNC_MCP_RELATIVE_FILE_PATH), overlayMcp);

    await runGenerate({
      target: "claudecode",
      features: "mcp",
      inputRoots: [baseRoot, overlayRoot],
    });

    const parsed = JSON.parse(await readFileContent(join(outputDir, ".mcp.json")));
    expect(parsed.mcpServers.shared.command).toBe("overlay-cmd");
    expect(parsed.mcpServers["base-only"].command).toBe("base-only-cmd");
    expect(parsed.mcpServers["overlay-only"].command).toBe("overlay-only-cmd");
  });
});
