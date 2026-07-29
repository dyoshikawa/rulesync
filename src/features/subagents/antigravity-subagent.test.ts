import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AntigravityCliSubagent } from "./antigravity-cli-subagent.js";
import { AntigravityIdeSubagent } from "./antigravity-ide-subagent.js";
import { AntigravityPluginSubagent } from "./antigravity-plugin-subagent.js";
import { AntigravitySharedSubagent } from "./antigravity-shared-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

const PROJECT_DIR = join(".agents", "agents");
const GLOBAL_DIR = join(".gemini", "config", "agents");

const buildRulesyncSubagent = (overrides?: {
  body?: string;
  name?: string;
  description?: string;
  targets?: string[];
  section?: Record<string, unknown>;
  sectionKey?: string;
}): RulesyncSubagent =>
  new RulesyncSubagent({
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: `${overrides?.name ?? "planner"}.md`,
    frontmatter: {
      targets: (overrides?.targets ?? ["*"]) as ["*"],
      name: overrides?.name ?? "planner",
      ...(overrides?.description === undefined ? {} : { description: overrides.description }),
      ...(overrides?.section
        ? { [overrides.sectionKey ?? "antigravity-cli"]: overrides.section }
        : {}),
    },
    body: overrides?.body ?? "Break down tasks into steps.",
  });

const targets = [
  { name: "AntigravityCliSubagent", SubagentClass: AntigravityCliSubagent, key: "antigravity-cli" },
  { name: "AntigravityIdeSubagent", SubagentClass: AntigravityIdeSubagent, key: "antigravity-ide" },
] as const;

describe("Antigravity custom agents", () => {
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

  describe.each(targets)("$name", ({ SubagentClass, key }) => {
    describe("getSettablePaths", () => {
      it("returns the shared project and global custom-agent dirs", () => {
        expect(SubagentClass.getSettablePaths().relativeDirPath).toBe(PROJECT_DIR);
        expect(SubagentClass.getSettablePaths({ global: true }).relativeDirPath).toBe(GLOBAL_DIR);
      });
    });

    describe("fromRulesyncSubagent", () => {
      it("emits a Markdown custom-agent file with name/description frontmatter", () => {
        const subagent = SubagentClass.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent: buildRulesyncSubagent({ description: "Plans tasks" }),
        }) as AntigravitySharedSubagent;

        expect(subagent.getRelativeDirPath()).toBe(PROJECT_DIR);
        expect(subagent.getRelativeFilePath()).toBe("planner.md");
        expect(subagent.getFrontmatter()).toEqual({
          name: "planner",
          description: "Plans tasks",
        });
        expect(subagent.getBody()).toBe("Break down tasks into steps.");
        expect(subagent.getFileContent()).toContain("name: planner");
      });

      it("carries the documented typed fields and unknown future keys through the tool section", () => {
        const subagent = SubagentClass.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent: buildRulesyncSubagent({
            description: "Plans tasks",
            sectionKey: key,
            section: {
              tools: ["view_file", "run_command"],
              mainAgent: false,
              subagent: true,
              model: "pro",
              commandExecutionPolicy: "auto",
              mcpServers: [{ name: "github" }],
              skills: ["review"],
              plugins: ["docs"],
              hidden: true,
              inheritMcp: false,
              futureField: "kept",
            },
          }),
        }) as AntigravitySharedSubagent;

        const frontmatter = subagent.getFrontmatter() as Record<string, unknown>;
        expect(frontmatter.tools).toEqual(["view_file", "run_command"]);
        expect(frontmatter.mainAgent).toBe(false);
        expect(frontmatter.model).toBe("pro");
        expect(frontmatter.commandExecutionPolicy).toBe("auto");
        expect(frontmatter.mcpServers).toEqual([{ name: "github" }]);
        expect(frontmatter.skills).toEqual(["review"]);
        expect(frontmatter.plugins).toEqual(["docs"]);
        // Unconfirmed upstream semantics: passthrough only, no behavior modeled.
        expect(frontmatter.hidden).toBe(true);
        expect(frontmatter.inheritMcp).toBe(false);
        expect(frontmatter.futureField).toBe("kept");
      });

      it("fills in a description Antigravity requires when the canonical file omits it", () => {
        const subagent = SubagentClass.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent: buildRulesyncSubagent(),
        }) as AntigravitySharedSubagent;

        expect(subagent.getFrontmatter().description).toBe("planner subagent");
      });

      it("never lets the tool section overwrite the canonical name", () => {
        const subagent = SubagentClass.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent: buildRulesyncSubagent({
            description: "Plans tasks",
            sectionKey: key,
            section: { name: "hijacked", description: "hijacked" },
          }),
        }) as AntigravitySharedSubagent;

        expect(subagent.getFrontmatter().name).toBe("planner");
        expect(subagent.getFrontmatter().description).toBe("Plans tasks");
      });

      it("reads the other shared target's section, since both write the same file", () => {
        const otherKey = key === "antigravity-cli" ? "antigravity-ide" : "antigravity-cli";
        const subagent = SubagentClass.fromRulesyncSubagent({
          relativeDirPath: PROJECT_DIR,
          rulesyncSubagent: buildRulesyncSubagent({
            description: "Plans tasks",
            sectionKey: otherKey,
            section: { model: "pro", tools: ["view_file"] },
          }),
        }) as AntigravitySharedSubagent;

        expect(subagent.getFrontmatter().model).toBe("pro");
        expect(subagent.getFrontmatter().tools).toEqual(["view_file"]);
      });

      it("writes to the shared global dir when global is set", () => {
        const subagent = SubagentClass.fromRulesyncSubagent({
          relativeDirPath: GLOBAL_DIR,
          rulesyncSubagent: buildRulesyncSubagent({ description: "Plans tasks" }),
          global: true,
        }) as AntigravitySharedSubagent;

        expect(subagent.getRelativeDirPath()).toBe(GLOBAL_DIR);
      });
    });

    describe("toRulesyncSubagent", () => {
      it("round-trips name/description/body and lifts extras into the tool section", () => {
        const subagent = new SubagentClass({
          relativeDirPath: PROJECT_DIR,
          relativeFilePath: "planner.md",
          frontmatter: { name: "planner", description: "Plans tasks", model: "flash" },
          body: "Break down tasks into steps.",
        });

        const frontmatter = subagent.toRulesyncSubagent().getFrontmatter();
        expect(frontmatter.name).toBe("planner");
        expect(frontmatter.description).toBe("Plans tasks");
        expect(frontmatter[key]).toEqual({ model: "flash" });
      });
    });

    describe("fromFile", () => {
      it("loads a custom-agent file from disk", async () => {
        await writeFileContent(
          join(testDir, PROJECT_DIR, "planner.md"),
          "---\nname: planner\ndescription: Plans tasks\nmodel: pro\n---\n\n# Role\n\nBreak down tasks.",
        );

        const subagent = await SubagentClass.fromFile({
          outputRoot: testDir,
          relativeFilePath: "planner.md",
        });

        expect(subagent.getFrontmatter().name).toBe("planner");
        expect(subagent.getBody()).toBe("# Role\n\nBreak down tasks.");
        expect(subagent.toRulesyncSubagent().getFrontmatter()[key]).toEqual({ model: "pro" });
      });

      it("rejects a custom-agent file missing the required description", async () => {
        await writeFileContent(
          join(testDir, PROJECT_DIR, "broken.md"),
          "---\nname: broken\n---\n\nBody.",
        );

        await expect(
          SubagentClass.fromFile({ outputRoot: testDir, relativeFilePath: "broken.md" }),
        ).rejects.toThrow("Invalid frontmatter");
      });
    });

    describe("isTargetedByRulesyncSubagent", () => {
      it("matches the wildcard and its own target only", () => {
        expect(SubagentClass.isTargetedByRulesyncSubagent(buildRulesyncSubagent())).toBe(true);
        expect(
          SubagentClass.isTargetedByRulesyncSubagent(buildRulesyncSubagent({ targets: [key] })),
        ).toBe(true);
        expect(
          SubagentClass.isTargetedByRulesyncSubagent(
            buildRulesyncSubagent({ targets: ["claudecode"] }),
          ),
        ).toBe(false);
      });
    });
  });

  describe("shared-file section precedence", () => {
    const bothSections = new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "planner.md",
      frontmatter: {
        targets: ["*"],
        name: "planner",
        description: "Plans tasks",
        "antigravity-ide": { model: "flash", mainAgent: false },
        "antigravity-cli": { model: "pro" },
        "antigravity-plugin": { commandExecutionPolicy: "off" },
      },
      body: "Body.",
    });

    it.each([AntigravityCliSubagent, AntigravityIdeSubagent])(
      "resolves both shared sections identically, CLI winning, for %p",
      (SubagentClass) => {
        const frontmatter = (
          SubagentClass.fromRulesyncSubagent({
            relativeDirPath: PROJECT_DIR,
            rulesyncSubagent: bothSections,
          }) as AntigravitySharedSubagent
        ).getFrontmatter();

        // Same output regardless of which target generated it — the two share
        // the very same file, so generation order must not change its content.
        expect(frontmatter.model).toBe("pro");
        expect(frontmatter.mainAgent).toBe(false);
        // The plugin bundle is a different file, so its section stays out.
        expect(frontmatter.commandExecutionPolicy).toBeUndefined();
      },
    );

    it("layers the plugin section on top of the shared ones", () => {
      const frontmatter = (
        AntigravityPluginSubagent.fromRulesyncSubagent({
          relativeDirPath: "agents",
          rulesyncSubagent: bothSections,
        }) as AntigravitySharedSubagent
      ).getFrontmatter();

      expect(frontmatter.model).toBe("pro");
      expect(frontmatter.mainAgent).toBe(false);
      expect(frontmatter.commandExecutionPolicy).toBe("off");
    });
  });

  describe("AntigravityPluginSubagent", () => {
    it("writes into the plugin bundle agents dir and answers to its own target", () => {
      expect(AntigravityPluginSubagent.getSettablePaths().relativeDirPath).toBe("agents");
      expect(
        AntigravityPluginSubagent.isTargetedByRulesyncSubagent(
          buildRulesyncSubagent({ targets: ["antigravity-plugin"] }),
        ),
      ).toBe(true);
      expect(
        AntigravityPluginSubagent.isTargetedByRulesyncSubagent(
          buildRulesyncSubagent({ targets: ["antigravity-cli"] }),
        ),
      ).toBe(false);
    });

    it("round-trips extras through the antigravity-plugin section", () => {
      const subagent = new AntigravityPluginSubagent({
        relativeDirPath: "agents",
        relativeFilePath: "planner.md",
        frontmatter: { name: "planner", description: "Plans tasks", subagent: false },
        body: "Body.",
      });

      expect(subagent.toRulesyncSubagent().getFrontmatter()["antigravity-plugin"]).toEqual({
        subagent: false,
      });
    });

    it("generates into and loads back from the bundle dir", async () => {
      const generated = AntigravityPluginSubagent.fromRulesyncSubagent({
        relativeDirPath: "agents",
        rulesyncSubagent: buildRulesyncSubagent({ description: "Plans tasks" }),
      });
      expect(generated.getRelativeDirPath()).toBe("agents");

      await writeFileContent(join(testDir, "agents", "planner.md"), generated.getFileContent());
      const loaded = await AntigravityPluginSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "planner.md",
      });
      expect(loaded).toBeInstanceOf(AntigravityPluginSubagent);
      expect(loaded.getFrontmatter().name).toBe("planner");
    });
  });

  describe("forDeletion", () => {
    it.each([AntigravityCliSubagent, AntigravityIdeSubagent, AntigravityPluginSubagent])(
      "builds an empty placeholder without validating for %p",
      (SubagentClass) => {
        const subagent = SubagentClass.forDeletion({
          relativeDirPath: PROJECT_DIR,
          relativeFilePath: "planner.md",
        });

        expect(subagent).toBeInstanceOf(SubagentClass);
        expect(subagent.getFileContent()).toBe("");
      },
    );
  });
});
