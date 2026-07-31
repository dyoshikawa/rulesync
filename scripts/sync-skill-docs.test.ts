import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncSkillDocs } from "./sync-skill-docs.js";

describe("syncSkillDocs", () => {
  const testRoot = join(
    process.cwd(),
    "tmp",
    "tests",
    "projects",
    `sync-skill-docs-${process.pid}`,
  );
  const skillDir = join(testRoot, "skills", "rulesync");

  beforeEach(() => {
    mkdirSync(skillDir, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(testRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("prunes every file except SKILL.md", () => {
    writeFileSync(join(skillDir, "SKILL.md"), "# Rulesync\n");
    writeFileSync(join(skillDir, "faq.md"), "# stale mirror\n");
    writeFileSync(join(skillDir, "configuration.md"), "# stale mirror\n");
    mkdirSync(join(skillDir, "nested"));
    writeFileSync(join(skillDir, "nested", "extra.md"), "# stale\n");

    const { removed } = syncSkillDocs();

    expect(removed.toSorted()).toEqual(["configuration.md", "faq.md", "nested"]);
    expect(readdirSync(skillDir)).toEqual(["SKILL.md"]);
    expect(existsSync(join(skillDir, "nested"))).toBe(false);
  });

  it("is a no-op when only SKILL.md exists", () => {
    writeFileSync(join(skillDir, "SKILL.md"), "# Rulesync\n");

    const { removed } = syncSkillDocs();

    expect(removed).toEqual([]);
    expect(readdirSync(skillDir)).toEqual(["SKILL.md"]);
  });

  it("throws when SKILL.md is missing instead of emptying the directory", () => {
    writeFileSync(join(skillDir, "faq.md"), "# stale mirror\n");

    expect(() => syncSkillDocs()).toThrow(/SKILL\.md is missing/);
    expect(existsSync(join(skillDir, "faq.md"))).toBe(true);
  });
});
