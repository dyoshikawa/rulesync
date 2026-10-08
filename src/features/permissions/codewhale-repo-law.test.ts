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
          paths: ["docs/a/*.md", "docs/b/*.md"],
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

  it("expands braces so an empty alternative keeps its meaning", async () => {
    const document = await generate({
      permission: { write: { ".env{,.local}": "deny", "a/{b,{c,d}}/x": "ask" } },
    });

    expect(document.protected_invariants).toEqual([
      expect.objectContaining({ paths: [".env", ".env.local"], action: "block" }),
      expect.objectContaining({ paths: ["a/b/x", "a/c/x", "a/d/x"], action: "ask" }),
    ]);
  });

  it("treats a trailing / inside a brace group as a directory", async () => {
    const document = await generate({
      permission: { write: { "{secrets/,config.json}": "deny" } },
    });

    expect(document.protected_invariants).toEqual([
      expect.objectContaining({ paths: ["secrets/**", "config.json"], action: "block" }),
    ]);
  });

  it("widens classes to ? and normalizes segments the way Codewhale normalizes targets", async () => {
    const document = await generate({
      permission: {
        write: { "src/app/[id]/page.tsx": "deny", "secrets/": "deny", "./src/./a//b.ts": "ask" },
      },
    });

    expect(document.protected_invariants).toEqual([
      expect.objectContaining({ paths: ["src/app/?/page.tsx"], action: "block" }),
      expect.objectContaining({ paths: ["secrets/**"], action: "block" }),
      expect.objectContaining({ paths: ["src/a/b.ts"], action: "ask" }),
    ]);
  });

  it("does not repeat a restriction a hand-written path already holds with the same spelling", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        protected_invariants: [{ text: "Review.", paths: ["CHANGELOG.md"], action: "ask" }],
      }),
    );

    expect(await generate({ permission: { write: { "./CHANGELOG.md": "ask" } } })).toEqual({
      protected_invariants: [{ text: "Review.", paths: ["CHANGELOG.md"], action: "ask" }],
    });
  });

  it("still writes a hold a hand-written ./ path cannot enforce, since Codewhale does not normalize it", async () => {
    const handWritten = { text: "Review.", paths: ["./.env"], action: "block" };
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({ protected_invariants: [handWritten] }),
    );

    expect(await generate({ permission: { write: { ".env": "deny" } } })).toEqual({
      protected_invariants: [
        handWritten,
        {
          text: "rulesync permissions: writes to .env are denied",
          paths: [".env"],
          action: "block",
          managed_by: "rulesync",
        },
      ],
    });
  });

  it("does not let a value Codewhale trims differently stand in for a hold", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        protected_invariants: [
          { text: "x", paths: ["\uFEFF.env"], action: "block" },
          { text: "\u0085", paths: [".env"], action: "block" },
        ],
      }),
    );

    const document = await generate({ permission: { write: { ".env": "deny" } } });

    expect(document.protected_invariants).toContainEqual(
      expect.objectContaining({ paths: [".env"], action: "block", managed_by: "rulesync" }),
    );
  });

  it("round-trips hand-written braces and classes without adding a hold", async () => {
    const handWritten = [
      { text: "A", paths: ["docs/{a,b}.md"], action: "block" },
      { text: "B", paths: ["src/[ab].ts"], action: "block" },
    ];
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({ protected_invariants: handWritten }),
    );
    const imported = (await CodewhalePermissions.fromFile({ outputRoot: testDir }))
      .toRulesyncPermissions()
      .getJson();

    expect(await generate(imported)).toEqual({ protected_invariants: handWritten });
  });

  it("still writes a hold when a verbatim hand-written pattern is narrower or holds only one source", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        protected_invariants: [
          { text: "A", paths: ["{a,**}/b"], action: "block" },
          { text: "B", paths: ["docs/[ab].md"], action: "block" },
          { text: "C", paths: ["notes/[a-c-e].md"], action: "block" },
        ],
      }),
    );

    const document = await generate({
      permission: {
        write: {
          "{a,**}/b": "deny",
          "docs/[ab].md": "deny",
          "docs/[cd].md": "deny",
          "notes/[a-c-e].md": "deny",
        },
      },
    });

    expect(document.protected_invariants).toEqual([
      expect.objectContaining({ text: "A" }),
      expect.objectContaining({ text: "B" }),
      expect.objectContaining({ text: "C" }),
      expect.objectContaining({ paths: ["a/b", "**/b"], managed_by: "rulesync" }),
      expect.objectContaining({ paths: ["docs/?.md"], managed_by: "rulesync" }),
      expect.objectContaining({ paths: ["notes/?.md"], managed_by: "rulesync" }),
    ]);
  });

  it("warns about a hand-written entry Codewhale cannot parse", async () => {
    await writeFileContent(
      constitutionPath(),
      JSON.stringify({
        protected_invariants: [
          "Prose.",
          { text: "Advisory.", paths: [] },
          { paths: ["a/**"] },
          { text: "x", paths: null },
          { text: "y", action: "deny" },
        ],
      }),
    );
    const logger = createMockLogger();

    await generate({ permission: {} }, logger);

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining("3 hand-written"));
  });

  it("warns when a new constitution would hide an ancestor's", async () => {
    const parentConstitution = join(testDir, ".codewhale", "constitution.json");
    await writeFileContent(parentConstitution, JSON.stringify({ authority: ["AGENTS.md"] }));
    const logger = createMockLogger();

    await CodewhalePermissions.fromRulesyncPermissions({
      outputRoot: join(testDir, "packages", "foo"),
      rulesyncPermissions: rulesyncPermissions({ permission: { write: { "dist/**": "deny" } } }),
      logger,
    });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining(`${parentConstitution} already exists`),
    );
  });

  it("treats a null protected_invariants as absent, as Codewhale does", async () => {
    await writeFileContent(constitutionPath(), JSON.stringify({ protected_invariants: null }));

    expect(await generate({ permission: { write: { "dist/**": "deny" } } })).toEqual({
      protected_invariants: [expect.objectContaining({ paths: ["dist/**"], action: "block" })],
    });
  });

  it("fails on an existing protected_invariants that is not an array or a root that is not an object", async () => {
    await writeFileContent(constitutionPath(), JSON.stringify({ protected_invariants: "x" }));
    await expect(generate({ permission: {} })).rejects.toThrow("is not an array");

    await writeFileContent(constitutionPath(), "[]");
    await expect(generate({ permission: {} })).rejects.toThrow("is not a JSON object");
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
            "C:/Windows/**": "deny",
            "src/{a.ts": "deny",
            "src/a}.ts": "deny",
            "src\\*.ts": "deny",
            "{/etc/**,a}": "deny",
            "{~/n,a}": "deny",
            "a\ud800b": "deny",
          },
          read: { ".env": "deny" },
          bash: { "rm *": "deny" },
        },
      },
      logger,
    );

    expect(document).toEqual({});
    const warnings = vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
    for (const pattern of [
      "/etc/**",
      "~/notes/**",
      "../outside/**",
      "C:/Windows/**",
      "src/{a.ts",
      "src/a}.ts",
      "src\\*.ts",
      "{/etc/**,a}",
      "{~/n,a}",
      "a\ud800b",
    ]) {
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
          { text: "Null action fails Codewhale's parse.", paths: ["y/**"], action: null },
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
