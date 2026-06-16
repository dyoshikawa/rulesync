import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RooMode, RooSubagent, sanitizeRooSlug } from "./roo-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

function makeRulesyncSubagent({
  testDir,
  relativeFilePath = "planner.md",
  frontmatter,
  body = "You are the planner.",
}: {
  testDir: string;
  relativeFilePath?: string;
  frontmatter: Record<string, unknown>;
  body?: string;
}): RulesyncSubagent {
  return new RulesyncSubagent({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: frontmatter as never,
    body,
    validate: true,
  });
}

function parseModes(content: string): RooMode[] {
  const parsed = load(content) as { customModes: RooMode[] };
  return parsed.customModes;
}

describe("RooSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("writes the aggregated .roomodes at the workspace root", () => {
      const paths = RooSubagent.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: "." });
    });
  });

  describe("sanitizeRooSlug", () => {
    it("lowercases and collapses invalid characters into hyphens", () => {
      expect(sanitizeRooSlug("My Cool Agent!")).toBe("my-cool-agent");
      expect(sanitizeRooSlug("planner_v2")).toBe("planner-v2");
      expect(sanitizeRooSlug("--Lead--")).toBe("lead");
    });

    it("falls back to 'mode' when nothing usable remains", () => {
      expect(sanitizeRooSlug("!!!")).toBe("mode");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("maps a single subagent to one mode with default groups", () => {
      const rulesyncSubagent = makeRulesyncSubagent({
        testDir,
        relativeFilePath: "Planner Agent.md",
        frontmatter: {
          targets: ["roo"],
          name: "Planner",
          description: "Plans tasks",
        },
        body: "You are the planner.",
      });

      const roo = RooSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent,
        validate: true,
      }) as RooSubagent;

      expect(roo).toBeInstanceOf(RooSubagent);
      expect(roo.getRelativeFilePath()).toBe(".roomodes");
      expect(roo.getRelativeDirPath()).toBe(".");

      const modes = parseModes(roo.getFileContent());
      expect(modes).toHaveLength(1);
      expect(modes[0]).toMatchObject({
        slug: "planner-agent",
        name: "Planner",
        description: "Plans tasks",
        roleDefinition: "You are the planner.",
        groups: ["read", "edit", "command", "mcp"],
      });
    });
  });

  describe("fromRulesyncSubagents", () => {
    it("aggregates multiple subagents into one .roomodes file", () => {
      const planner = makeRulesyncSubagent({
        testDir,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["roo"], name: "Planner", description: "Plans" },
        body: "Planner role.",
      });
      const reviewer = makeRulesyncSubagent({
        testDir,
        relativeFilePath: "reviewer.md",
        frontmatter: { targets: ["roo"], name: "Reviewer", description: "Reviews" },
        body: "Reviewer role.",
      });

      const roo = RooSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [planner, reviewer],
      });

      const modes = parseModes(roo.getFileContent());
      expect(modes).toHaveLength(2);
      expect(modes.map((m) => m.slug)).toEqual(["planner", "reviewer"]);
    });

    it("de-duplicates by slug so a later subagent wins", () => {
      const first = makeRulesyncSubagent({
        testDir,
        relativeFilePath: "planner.md",
        frontmatter: { targets: ["roo"], name: "Planner", roo: { slug: "lead" } },
        body: "First.",
      });
      const second = makeRulesyncSubagent({
        testDir,
        relativeFilePath: "reviewer.md",
        frontmatter: { targets: ["roo"], name: "Reviewer", roo: { slug: "lead" } },
        body: "Second.",
      });

      const roo = RooSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [first, second],
      });

      const modes = parseModes(roo.getFileContent());
      expect(modes).toHaveLength(1);
      expect(modes[0]?.slug).toBe("lead");
      expect(modes[0]?.roleDefinition).toBe("Second.");
    });

    it("honors the roo: section for groups, whenToUse, customInstructions, and roleDefinition override", () => {
      const rulesyncSubagent = makeRulesyncSubagent({
        testDir,
        relativeFilePath: "docs.md",
        frontmatter: {
          targets: ["roo"],
          name: "Docs",
          description: "Doc writer",
          roo: {
            groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Markdown" }]],
            whenToUse: "When editing docs",
            customInstructions: "Be concise",
            roleDefinition: "You only touch docs.",
          },
        },
        body: "This body is overridden.",
      });

      const roo = RooSubagent.fromRulesyncSubagents({
        outputRoot: testDir,
        rulesyncSubagents: [rulesyncSubagent],
      });

      const modes = parseModes(roo.getFileContent());
      expect(modes[0]).toMatchObject({
        slug: "docs",
        name: "Docs",
        whenToUse: "When editing docs",
        customInstructions: "Be concise",
        roleDefinition: "You only touch docs.",
      });
      expect(modes[0]?.groups).toEqual([
        "read",
        ["edit", { fileRegex: "\\.md$", description: "Markdown" }],
      ]);
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("returns true when targets include roo", () => {
      const rulesyncSubagent = makeRulesyncSubagent({
        testDir,
        frontmatter: { targets: ["roo"], name: "Planner" },
      });
      expect(RooSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("returns false when targets exclude roo", () => {
      const rulesyncSubagent = makeRulesyncSubagent({
        testDir,
        frontmatter: { targets: ["copilot"], name: "Planner" },
      });
      expect(RooSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("fromFile and toRulesyncSubagents (import)", () => {
    const roomodesContent = `customModes:
  - slug: planner
    name: Planner
    description: Plans tasks
    roleDefinition: You are the planner.
    groups:
      - read
      - edit
  - slug: reviewer
    name: Reviewer
    roleDefinition: You are the reviewer.
    whenToUse: When reviewing code
    customInstructions: Be thorough
    groups:
      - read
`;

    it("parses every custom mode from .roomodes", async () => {
      await writeFileContent(join(testDir, ".roomodes"), roomodesContent);

      const roo = await RooSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".roomodes",
        validate: true,
      });

      expect(roo).toBeInstanceOf(RooSubagent);
      expect(roo.getModes()).toHaveLength(2);
    });

    it("fans out each mode into its own rulesync subagent", async () => {
      await writeFileContent(join(testDir, ".roomodes"), roomodesContent);

      const roo = await RooSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".roomodes",
        validate: true,
      });

      const rulesyncSubagents = roo.toRulesyncSubagents();
      expect(rulesyncSubagents).toHaveLength(2);

      const planner = rulesyncSubagents[0];
      expect(planner?.getRelativeFilePath()).toBe("planner.md");
      expect(planner?.getBody()).toBe("You are the planner.");
      expect(planner?.getFrontmatter()).toMatchObject({
        targets: ["roo"],
        name: "Planner",
        description: "Plans tasks",
      });

      const reviewer = rulesyncSubagents[1];
      expect(reviewer?.getFrontmatter()).toMatchObject({
        name: "Reviewer",
        roo: { whenToUse: "When reviewing code", customInstructions: "Be thorough" },
      });
    });

    it("throws on invalid .roomodes", async () => {
      await writeFileContent(
        join(testDir, ".roomodes"),
        "customModes:\n  - name: Missing slug and roleDefinition\n",
      );

      await expect(
        RooSubagent.fromFile({
          outputRoot: testDir,
          relativeFilePath: ".roomodes",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("returns success for valid modes", () => {
      const roo = new RooSubagent({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".roomodes",
        modes: [{ slug: "planner", name: "Planner", roleDefinition: "Role." }],
        validate: false,
      });
      expect(roo.validate().success).toBe(true);
    });

    it("throws in the constructor for an invalid mode when validation is enabled", () => {
      expect(
        () =>
          new RooSubagent({
            outputRoot: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".roomodes",
            modes: [{ slug: "planner" } as RooMode],
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("forDeletion", () => {
    it("creates a minimal instance without parsing", () => {
      const roo = RooSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".roomodes",
      });
      expect(roo).toBeInstanceOf(RooSubagent);
      expect(roo.getModes()).toEqual([]);
    });
  });
});
