import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GooseRule } from "./goose-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("GooseRule", () => {
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

  it("generates goose rule from rulesync root rule", () => {
    const rulesyncRule = new RulesyncRule({
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: "goosehints.md",
      frontmatter: {
        root: true,
        targets: ["goose"],
      },
      body: "Use TypeScript.",
    });

    const gooseRule = GooseRule.fromRulesyncRule({
      baseDir: testDir,
      rulesyncRule,
      validate: true,
    });

    expect(gooseRule.getRelativeDirPath()).toBe(".");
    expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    expect(gooseRule.getFileContent()).toBe("Use TypeScript.");
    expect(gooseRule.isRoot()).toBe(true);
  });

  it("creates goose rule from nested rulesync rule", () => {
    const rulesyncRule = new RulesyncRule({
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: join("frontend", "preferences.md"),
      frontmatter: {
        targets: ["goose"],
      },
      body: "Use Tailwind for UI work.",
    });

    const gooseRule = GooseRule.fromRulesyncRule({
      baseDir: testDir,
      rulesyncRule,
    });

    expect(gooseRule.getRelativeDirPath()).toBe(join("frontend"));
    expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    expect(gooseRule.isRoot()).toBe(false);
  });

  it("loads goose rule from file path including directory", async () => {
    const hintsDir = join(testDir, "frontend");
    await ensureDir(hintsDir);
    const hintsPath = join(hintsDir, ".goosehints");
    await writeFileContent(hintsPath, "Document patterns.");

    const gooseRule = await GooseRule.fromFile({
      baseDir: testDir,
      relativeFilePath: join("frontend", ".goosehints"),
    });

    expect(gooseRule.getRelativeDirPath()).toBe(join("frontend"));
    expect(gooseRule.getFileContent()).toBe("Document patterns.");
  });

  it("converts goose rule back to rulesync format", () => {
    const gooseRule = new GooseRule({
      baseDir: testDir,
      relativeDirPath: join("frontend"),
      relativeFilePath: ".goosehints",
      fileContent: "Review PR templates.",
    });

    const rulesyncRule = gooseRule.toRulesyncRule();

    expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
    expect(rulesyncRule.getRelativeFilePath()).toBe(join("frontend", "goosehints.md"));
    expect(rulesyncRule.getBody()).toBe("Review PR templates.");
    expect(rulesyncRule.getFrontmatter().root).toBe(false);
  });

  it("returns global settable path", () => {
    const paths = GooseRule.getSettablePaths({ global: true });

    expect(paths.nonRoot.relativeDirPath).toBe(join(".config", "goose"));
  });
});
