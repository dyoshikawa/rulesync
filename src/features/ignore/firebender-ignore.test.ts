import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { FirebenderIgnore } from "./firebender-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("FirebenderIgnore", () => {
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

  const makeRulesyncIgnore = (fileContent: string) =>
    new RulesyncIgnore({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".aiignore",
      fileContent,
    });

  it("should use firebender.json at the project root and under ~/.firebender globally", () => {
    expect(FirebenderIgnore.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "firebender.json",
    });
    expect(FirebenderIgnore.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".firebender",
      relativeFilePath: "firebender.json",
    });
  });

  it("should write the ignore key in source order without duplicates or comments", async () => {
    const ignore = await FirebenderIgnore.fromRulesyncIgnore({
      outputRoot: testDir,
      rulesyncIgnore: makeRulesyncIgnore("# secrets\n**/.env*\ndist/**\n\n**/.env*\n!dist/keep\n"),
    });

    // The last occurrence of a duplicate is the one kept.
    expect(JSON.parse(ignore.getFileContent())).toEqual({
      ignore: ["dist/**", "**/.env*", "!dist/keep"],
    });
    expect(ignore.getPatterns()).toEqual(["dist/**", "**/.env*", "!dist/keep"]);
  });

  // Under last-match-wins, keeping the first copy of a duplicate would lose a
  // re-ignore written after a negation and leave the file readable.
  it.each([
    [".env\n!.env\n.env\n", ["!.env", ".env"]],
    [".env*\n!.env.example\n.env*\n", ["!.env.example", ".env*"]],
  ])("should keep a re-ignore that follows a negation (%j)", async (content, expected) => {
    const ignore = await FirebenderIgnore.fromRulesyncIgnore({
      outputRoot: testDir,
      rulesyncIgnore: makeRulesyncIgnore(content),
    });

    expect(JSON.parse(ignore.getFileContent())).toEqual({ ignore: expected });
  });

  it("should replace only the ignore key and keep the other keys of firebender.json", async () => {
    await writeFileContent(
      join(testDir, "firebender.json"),
      JSON.stringify({
        ignore: ["old/**"],
        mcpServers: { weather: { command: "npx" } },
        agents: [".firebender/agents/reviewer.md"],
        useCursorRules: false,
      }),
    );

    const ignore = await FirebenderIgnore.fromRulesyncIgnore({
      outputRoot: testDir,
      rulesyncIgnore: makeRulesyncIgnore("new/**\n"),
    });

    expect(JSON.parse(ignore.getFileContent())).toEqual({
      ignore: ["new/**"],
      mcpServers: { weather: { command: "npx" } },
      agents: [".firebender/agents/reviewer.md"],
      useCursorRules: false,
    });
  });

  it("should remove the ignore key when no pattern is left", async () => {
    await writeFileContent(
      join(testDir, "firebender.json"),
      JSON.stringify({ ignore: ["old/**"], useCursorRules: false }),
    );

    const ignore = await FirebenderIgnore.fromRulesyncIgnore({
      outputRoot: testDir,
      rulesyncIgnore: makeRulesyncIgnore("# nothing\n"),
    });

    expect(JSON.parse(ignore.getFileContent())).toEqual({ useCursorRules: false });
  });

  it("should write the personal config under .firebender in global mode", async () => {
    const ignore = await FirebenderIgnore.fromRulesyncIgnore({
      outputRoot: testDir,
      rulesyncIgnore: makeRulesyncIgnore("**/*.pem\n"),
      global: true,
    });

    expect(ignore.getFilePath()).toBe(join(testDir, ".firebender", "firebender.json"));
    expect(JSON.parse(ignore.getFileContent())).toEqual({ ignore: ["**/*.pem"] });
  });

  it("should import the ignore key back into .aiignore", async () => {
    await writeFileContent(
      join(testDir, "firebender.json"),
      JSON.stringify({ ignore: ["**/.env", "build/**"], mcpServers: {} }),
    );

    const ignore = await FirebenderIgnore.fromFile({ outputRoot: testDir });

    expect(ignore.toRulesyncIgnore().getFileContent()).toBe("**/.env\nbuild/**");
    expect(await readFileContent(join(testDir, "firebender.json"))).toContain("mcpServers");
  });

  it("should never be deletable", () => {
    expect(
      FirebenderIgnore.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "firebender.json",
      }).isDeletable(),
    ).toBe(false);
  });
});
