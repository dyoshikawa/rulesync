import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURSOR_BUGBOT_FILE_NAME, CURSOR_DIR } from "../../constants/cursor-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CursorCheck } from "./cursor-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

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

function cursorCheck(fileContent: string): CursorCheck {
  return new CursorCheck({
    outputRoot: ".",
    relativeDirPath: CURSOR_DIR,
    relativeFilePath: CURSOR_BUGBOT_FILE_NAME,
    fileContent,
  });
}

describe("CursorCheck.getSettablePaths", () => {
  it("names the single instruction file Bugbot reads", () => {
    expect(CursorCheck.getSettablePaths()).toEqual({
      relativeDirPath: CURSOR_DIR,
      relativeFilePath: CURSOR_BUGBOT_FILE_NAME,
    });
  });
});

describe("CursorCheck.isTargetedByRulesyncCheck", () => {
  it("accepts wildcard and cursor targets, rejects others", () => {
    expect(CursorCheck.isTargetedByRulesyncCheck(rulesyncCheck({ name: "a", body: "x" }))).toBe(
      true,
    );
    expect(
      CursorCheck.isTargetedByRulesyncCheck(
        rulesyncCheck({ name: "a", body: "x", frontmatter: { targets: ["cursor"] } }),
      ),
    ).toBe(true);
    expect(
      CursorCheck.isTargetedByRulesyncCheck(
        rulesyncCheck({ name: "a", body: "x", frontmatter: { targets: ["amp"] } }),
      ),
    ).toBe(false);
  });
});

describe("CursorCheck.fromRulesyncCheck", () => {
  it("refuses the per-check conversion because the checks share one file", () => {
    expect(() =>
      CursorCheck.fromRulesyncCheck({
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncCheck: rulesyncCheck({ name: "a", body: "x" }),
      }),
    ).toThrow("use fromRulesyncChecks");
  });
});

describe("CursorCheck.fromRulesyncChecks", () => {
  it("collapses every check into one marked-up BUGBOT.md", async () => {
    const [check] = await CursorCheck.fromRulesyncChecks({
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      rulesyncChecks: [
        rulesyncCheck({ name: "security", body: "Look for injection." }),
        rulesyncCheck({ name: "style", body: "Prefer const." }),
      ],
    });

    expect(check?.getRelativeDirPath()).toBe(CURSOR_DIR);
    expect(check?.getRelativeFilePath()).toBe(CURSOR_BUGBOT_FILE_NAME);
    expect(check?.getFileContent()).toBe(
      [
        "<!-- rulesync:check:security -->",
        "## security",
        "",
        "Look for injection.",
        "",
        "<!-- rulesync:check:style -->",
        "## style",
        "",
        "Prefer const.",
        "",
      ].join("\n"),
    );
  });

  it("falls back to the description when a check has no body", async () => {
    const [check] = await CursorCheck.fromRulesyncChecks({
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      rulesyncChecks: [
        rulesyncCheck({ name: "style", frontmatter: { description: "Style only" } }),
      ],
    });

    expect(check?.getFileContent()).toContain("Style only");
  });

  it("drops severity and tools, which Bugbot has no field for", async () => {
    const [check] = await CursorCheck.fromRulesyncChecks({
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      rulesyncChecks: [
        rulesyncCheck({
          name: "security",
          body: "Look for injection.",
          frontmatter: { severity: "high", tools: ["Read"] },
        }),
      ],
    });

    expect(check?.getFileContent()).not.toContain("high");
    expect(check?.getFileContent()).not.toContain("Read");
  });

  it("writes no file when no check targets Cursor", async () => {
    expect(
      await CursorCheck.fromRulesyncChecks({
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [],
      }),
    ).toEqual([]);
  });
});

describe("CursorCheck.toRulesyncChecks", () => {
  it("splits the generated sections back into one check each", () => {
    const checks = cursorCheck(
      [
        "<!-- rulesync:check:security -->",
        "## security",
        "",
        "Look for injection.",
        "",
        "<!-- rulesync:check:style -->",
        "## style",
        "",
        "Prefer const.",
        "",
      ].join("\n"),
    ).toRulesyncChecks();

    expect(checks.map((check) => check.getRelativeFilePath())).toEqual(["security.md", "style.md"]);
    // The heading generate writes is stripped, so a round trip does not stack headings.
    expect(checks[0]?.getBody()).toBe("Look for injection.");
    expect(checks[1]?.getBody()).toBe("Prefer const.");
    expect(checks[0]?.getFrontmatter().targets).toEqual(["*"]);
  });

  it("imports a hand-written file with no markers as a single check", () => {
    const checks = cursorCheck("Never log secrets.\n").toRulesyncChecks();

    expect(checks).toHaveLength(1);
    expect(checks[0]?.getRelativeFilePath()).toBe("bugbot.md");
    expect(checks[0]?.getBody()).toBe("Never log secrets.");
  });

  it("keeps hand-written text sitting ahead of the first marker", () => {
    const checks = cursorCheck(
      [
        "Never log secrets.",
        "",
        "<!-- rulesync:check:style -->",
        "## style",
        "",
        "Prefer const.",
      ].join("\n"),
    ).toRulesyncChecks();

    expect(checks.map((check) => check.getRelativeFilePath())).toEqual(["bugbot.md", "style.md"]);
    expect(checks[0]?.getBody()).toBe("Never log secrets.");
  });

  it("slugifies a marker name so it cannot escape the checks directory", () => {
    const checks = cursorCheck(
      ["<!-- rulesync:check:../../etc/passwd -->", "Do something."].join("\n"),
    ).toRulesyncChecks();

    expect(checks[0]?.getRelativeFilePath()).toBe("etc-passwd.md");
  });

  it("keeps two markers that slugify the same from overwriting each other", () => {
    const checks = cursorCheck(
      [
        "<!-- rulesync:check:Style Guide -->",
        "First.",
        "",
        "<!-- rulesync:check:style-guide -->",
        "Second.",
      ].join("\n"),
    ).toRulesyncChecks();

    expect(checks.map((check) => check.getRelativeFilePath())).toEqual([
      "style-guide.md",
      "style-guide-2.md",
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(cursorCheck("").toRulesyncChecks()).toEqual([]);
    expect(() => cursorCheck("").toRulesyncCheck()).toThrow("No check instructions found");
  });
});

describe("CursorCheck.fromFile", () => {
  it("reads the instruction file", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      await writeFileContent(
        join(testDir, CURSOR_DIR, CURSOR_BUGBOT_FILE_NAME),
        "Never log secrets.\n",
      );

      const check = await CursorCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: CURSOR_BUGBOT_FILE_NAME,
      });

      expect(check.getFileContent()).toBe("Never log secrets.\n");
    } finally {
      await cleanup();
    }
  });

  it("reads an absent file as empty rather than creating it", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const check = await CursorCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: CURSOR_BUGBOT_FILE_NAME,
      });

      expect(check.getFileContent()).toBe("");
    } finally {
      await cleanup();
    }
  });
});
