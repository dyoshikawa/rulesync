import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhalePermissions } from "./codewhale-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(json: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(json),
  });
}

describe("CodewhalePermissions (project scope: .codewhale/constitution.json)", () => {
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

  const constitutionPath = (): string => join(testDir, ".codewhale", "constitution.json");

  const generate = async (json: Record<string, unknown>, logger = createMockLogger()) => {
    const perms = await CodewhalePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions(json),
      logger,
    });
    return JSON.parse(perms.getFileContent()) as Record<string, unknown>;
  };

  it("targets .codewhale/constitution.json", () => {
    expect(CodewhalePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".codewhale",
      relativeFilePath: "constitution.json",
    });
  });

  it("writes deny as block and ask as ask, the strongest action per glob", async () => {
    const document = await generate({
      permission: {
        write: { "crates/protocol/**": "deny", "./CHANGELOG.md": "ask" },
        edit: { "crates/protocol/**": "ask", "docs/{a,b}/*.md": "ask" },
      },
    });

    expect(document).toEqual({
      schema_version: 1,
      protected_invariants: [
        {
          text: "rulesync permissions: writes to crates/protocol/** are denied",
          paths: ["crates/protocol/**"],
          action: "block",
          managed_by: "rulesync",
        },
        {
          text: "rulesync permissions: writes to CHANGELOG.md need approval",
          paths: ["CHANGELOG.md"],
          action: "ask",
          managed_by: "rulesync",
        },
        {
          text: "rulesync permissions: writes to docs/{a,b}/*.md need approval",
          paths: ["docs/{a,b}/*.md"],
          action: "ask",
          managed_by: "rulesync",
        },
      ],
    });
  });

  it("writes all-tools restrictions as holds too", async () => {
    const document = await generate({ permission: { "*": { "secrets/**": "deny" } } });

    expect(document.protected_invariants).toEqual([
      expect.objectContaining({ paths: ["secrets/**"], action: "block" }),
    ]);
  });

  it("skips allow rules, other categories and patterns Codewhale cannot hold, with warnings", async () => {
    const logger = createMockLogger();
    const document = await generate(
      {
        permission: {
          write: {
            "src/**": "allow",
            "/etc/**": "deny",
            "~/notes/**": "deny",
            "../outside/**": "deny",
            "src/[ab].ts": "deny",
            "src/{a.ts": "deny",
          },
          read: { ".env": "deny" },
          bash: { "rm *": "deny" },
        },
      },
      logger,
    );

    expect(document).toEqual({});
    const warnings = vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
    for (const pattern of ["/etc/**", "~/notes/**", "../outside/**", "src/[ab].ts", "src/{a.ts"]) {
      expect(warnings.some((message) => message.includes(`"${pattern}"`))).toBe(true);
    }
    expect(warnings.some((message) => message.includes('"read", "bash"'))).toBe(true);
    expect(warnings.some((message) => message.includes("1 allow rule(s)"))).toBe(true);
  });

  it("keeps other keys and hand-written invariants, replacing only rulesync's own", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        schema_version: 1,
        authority: ["current user request", "AGENTS.md"],
        protected_invariants: [
          "Keep DeepSeek support first-class.",
          { text: "Release notes need human review.", paths: ["CHANGELOG.md"] },
          {
            text: "rulesync permissions: writes to old/** are denied",
            paths: ["old/**"],
            action: "block",
            managed_by: "rulesync",
          },
        ],
        branch_policy: "PRs target main",
      }),
    );

    const document = await generate({
      permission: { write: { "CHANGELOG.md": "ask", "dist/**": "deny" } },
    });

    expect(document).toEqual({
      schema_version: 1,
      authority: ["current user request", "AGENTS.md"],
      protected_invariants: [
        "Keep DeepSeek support first-class.",
        { text: "Release notes need human review.", paths: ["CHANGELOG.md"] },
        {
          text: "rulesync permissions: writes to dist/** are denied",
          paths: ["dist/**"],
          action: "block",
          managed_by: "rulesync",
        },
      ],
      branch_policy: "PRs target main",
    });
  });

  it("removes its own invariants when nothing maps, keeping the file's other content", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        authority: ["AGENTS.md"],
        protected_invariants: [
          { text: "x", paths: ["a/**"], action: "block", managed_by: "rulesync" },
        ],
      }),
    );

    expect(await generate({ permission: {} })).toEqual({
      authority: ["AGENTS.md"],
      protected_invariants: [],
    });
  });

  it("fails on an existing file that is not valid JSON", async () => {
    await writeFileContent(constitutionPath(), "{ not json");

    await expect(generate({ permission: {} })).rejects.toThrow(
      "Failed to parse existing Codewhale constitution",
    );
  });

  it("imports enforced invariants into write and edit, ignoring advisory ones", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        protected_invariants: [
          "Prose only.",
          { text: "No paths, advisory." },
          { text: "", paths: ["ignored/**"], action: "block" },
          { text: "Frozen.", paths: ["crates/protocol/**", " "], action: "block" },
          { text: "Review.", paths: ["CHANGELOG.md", "crates/protocol/**"] },
          { text: "Unknown action.", paths: ["x/**"], action: "allow" },
        ],
      }),
    );

    const perms = await CodewhalePermissions.fromFile({ outputRoot: testDir });
    const imported = perms.toRulesyncPermissions().getJson();

    const expected = { "crates/protocol/**": "deny", "CHANGELOG.md": "ask" };
    expect(imported.permission).toEqual({ write: expected, edit: expected });
  });

  it("round-trips: a regenerate after import writes no duplicate hold", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        protected_invariants: [{ text: "Review.", paths: ["CHANGELOG.md"], action: "ask" }],
      }),
    );
    const imported = (await CodewhalePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(await generate(imported)).toEqual({
      protected_invariants: [{ text: "Review.", paths: ["CHANGELOG.md"], action: "ask" }],
    });
  });
});
