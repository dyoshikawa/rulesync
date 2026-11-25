import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OpenbitfunSubagent } from "./openbitfun-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("OpenbitfunSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const makeRulesyncSubagent = (frontmatter: Record<string, unknown>) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "reviewer.md",
      frontmatter: { targets: ["*"], name: "reviewer", ...frontmatter } as never,
      body: "Review the diff.",
      validate: true,
    });

  describe("getSettablePaths", () => {
    it("should use .openbitfun/agents in project scope", () => {
      expect(OpenbitfunSubagent.getSettablePaths().relativeDirPath).toBe(
        join(".openbitfun", "agents"),
      );
    });

    it.each([
      ["linux", join(".config", "openbitfun", "agents")],
      ["darwin", join("Library", "Application Support", "openbitfun", "agents")],
      ["win32", join("AppData", "Roaming", "openbitfun", "agents")],
    ] as const)("should use the %s user root in global scope", (platform, expected) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(OpenbitfunSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(expected);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should write kind: subagent with name and description", () => {
      const subagent = OpenbitfunSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: makeRulesyncSubagent({ description: "Reviews code" }),
      }) as OpenbitfunSubagent;

      expect(subagent.getRelativeDirPath()).toBe(join(".openbitfun", "agents"));
      expect(subagent.getRelativeFilePath()).toBe("reviewer.md");
      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
        kind: "subagent",
      });
      expect(subagent.getFileContent()).toContain("kind: subagent");
      expect(subagent.getBody()).toBe("Review the diff.");
    });

    it("should spread the openbitfun section on top", () => {
      const subagent = OpenbitfunSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: makeRulesyncSubagent({
          description: "Reviews code",
          openbitfun: {
            name: "ignored",
            tools: ["Read", "Grep"],
            model: "fast",
            readonly: true,
            review: true,
          },
        }),
      }) as OpenbitfunSubagent;

      expect(subagent.getFrontmatter()).toEqual({
        name: "reviewer",
        description: "Reviews code",
        kind: "subagent",
        tools: ["Read", "Grep"],
        model: "fast",
        readonly: true,
        review: true,
      });
    });

    it("should write an empty description when none is set", () => {
      const subagent = OpenbitfunSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: makeRulesyncSubagent({}),
      }) as OpenbitfunSubagent;

      expect(subagent.getFrontmatter().description).toBe("");
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should move native fields into the openbitfun section and drop the default kind", async () => {
      await writeFileContent(
        join(testDir, ".openbitfun", "agents", "reviewer.md"),
        "---\nname: reviewer\ndescription: Reviews code\nkind: subagent\ntools: Read, Grep\nreadonly: true\n---\nReview the diff.\n",
      );

      const subagent = await OpenbitfunSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "reviewer.md",
      });
      const rulesync = subagent.toRulesyncSubagent();

      expect(rulesync.getFrontmatter()).toEqual({
        targets: ["*"],
        name: "reviewer",
        description: "Reviews code",
        openbitfun: { tools: "Read, Grep", readonly: true },
      });
      expect(rulesync.getBody()).toBe("Review the diff.");
    });

    it("should keep a non-default kind", () => {
      const subagent = new OpenbitfunSubagent({
        outputRoot: testDir,
        relativeDirPath: join(".openbitfun", "agents"),
        relativeFilePath: "writer.md",
        frontmatter: { name: "writer", description: "Writes docs", kind: "mode" },
        body: "Write docs.",
        fileContent: "",
      });

      expect(subagent.toRulesyncSubagent().getFrontmatter().openbitfun).toEqual({ kind: "mode" });
    });
  });

  it("should only target openbitfun or wildcard subagents", () => {
    expect(
      OpenbitfunSubagent.isTargetedByRulesyncSubagent(makeRulesyncSubagent({ targets: ["*"] })),
    ).toBe(true);
    expect(
      OpenbitfunSubagent.isTargetedByRulesyncSubagent(
        makeRulesyncSubagent({ targets: ["openbitfun"] }),
      ),
    ).toBe(true);
    expect(
      OpenbitfunSubagent.isTargetedByRulesyncSubagent(
        makeRulesyncSubagent({ targets: ["cursor"] }),
      ),
    ).toBe(false);
  });
});
