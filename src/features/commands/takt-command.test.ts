import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { resolveTaktCommandFacetDir, TaktCommand } from "./takt-command.js";

describe("TaktCommand", () => {
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

  describe("getSettablePaths", () => {
    it("returns the instructions facet directory", () => {
      expect(TaktCommand.getSettablePaths().relativeDirPath).toBe(
        join(".takt", "facets", "instructions"),
      );
    });
  });

  describe("resolveTaktCommandFacetDir", () => {
    it("defaults to instructions", () => {
      expect(resolveTaktCommandFacetDir(undefined, "x.md")).toBe("instructions");
    });
    it("accepts instruction", () => {
      expect(resolveTaktCommandFacetDir("instruction", "x.md")).toBe("instructions");
    });
    it("rejects other values", () => {
      expect(() => resolveTaktCommandFacetDir("knowledge", "x.md")).toThrow(/Invalid takt\.facet/);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("emits a plain Markdown body under instructions/", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: { targets: ["*"], description: "Review PR" },
        body: "Run review steps.",
        fileContent: "",
      });

      const cmd = TaktCommand.fromRulesyncCommand({ baseDir: testDir, rulesyncCommand });
      expect(cmd.getRelativeDirPath()).toBe(join(".takt", "facets", "instructions"));
      expect(cmd.getRelativeFilePath()).toBe("review.md");
      expect(cmd.getFileContent()).toBe("Run review steps.");
    });

    it("renames the stem with takt.name", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "long-source.md",
        frontmatter: {
          targets: ["*"],
          ...({ takt: { name: "short" } } as Record<string, unknown>),
        },
        body: "body",
        fileContent: "",
      });
      const cmd = TaktCommand.fromRulesyncCommand({ baseDir: testDir, rulesyncCommand });
      expect(cmd.getRelativeFilePath()).toBe("short.md");
    });

    it("throws on an unsafe takt.name value", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "src.md",
        frontmatter: {
          targets: ["*"],
          ...({ takt: { name: "../escape" } } as Record<string, unknown>),
        },
        body: "x",
        fileContent: "",
      });
      expect(() => TaktCommand.fromRulesyncCommand({ baseDir: testDir, rulesyncCommand })).toThrow(
        /Invalid takt\.name/,
      );
    });

    it("throws on a disallowed takt.facet", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "p.md",
        frontmatter: {
          targets: ["*"],
          ...({ takt: { facet: "policy" } } as Record<string, unknown>),
        },
        body: "x",
        fileContent: "",
      });
      expect(() => TaktCommand.fromRulesyncCommand({ baseDir: testDir, rulesyncCommand })).toThrow(
        /Invalid takt\.facet/,
      );
    });
  });

  describe("fromFile", () => {
    it("loads a plain Markdown instructions file", async () => {
      const dir = join(testDir, ".takt", "facets", "instructions");
      await ensureDir(dir);
      await writeFileContent(join(dir, "x.md"), "body\n");
      const cmd = await TaktCommand.fromFile({ baseDir: testDir, relativeFilePath: "x.md" });
      expect(cmd.getBody()).toBe("body");
    });
  });

  describe("forDeletion", () => {
    it("constructs a deletable empty instance", () => {
      const cmd = TaktCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "instructions"),
        relativeFilePath: "x.md",
      });
      expect(cmd.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it.each([
      [["*"], true],
      [["takt"], true],
      [["claudecode"], false],
    ] as const)("targets=%j → %s", (targets, expected) => {
      const r = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "x.md",
        frontmatter: { targets: [...targets] },
        body: "y",
        fileContent: "",
      });
      expect(TaktCommand.isTargetedByRulesyncCommand(r)).toBe(expected);
    });
  });
});
