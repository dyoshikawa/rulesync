import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { loadYaml } from "../../utils/yaml.js";
import { BobSubagent } from "./bob-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("BobSubagent", () => {
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

  const makeSubagent = (frontmatter: Record<string, unknown>, relativeFilePath = "planner.md") =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath,
      frontmatter: {
        targets: ["bob"],
        name: "Planner",
        description: "Plans work",
        ...frontmatter,
      } as never,
      body: "You are a planner.",
      validate: true,
    });

  it("writes project-scope custom modes to .bob/custom_modes.yaml", () => {
    expect(BobSubagent.getSettablePaths()).toEqual({
      relativeDirPath: ".bob",
      relativeFilePath: "custom_modes.yaml",
    });

    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({})],
    });

    expect(subagent).toBeInstanceOf(BobSubagent);
    expect(subagent.getRelativeDirPath()).toBe(".bob");
    expect(subagent.getRelativeFilePath()).toBe("custom_modes.yaml");
  });

  it("writes global-scope custom modes to ~/.bob/settings/custom_modes.yaml", () => {
    expect(BobSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".bob", "settings"),
      relativeFilePath: "custom_modes.yaml",
    });

    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({})],
      global: true,
    });

    expect(subagent.getRelativeDirPath()).toBe(join(".bob", "settings"));
    expect(subagent.getRelativeFilePath()).toBe("custom_modes.yaml");

    const single = BobSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/subagents",
      rulesyncSubagent: makeSubagent({}),
      global: true,
    });
    expect(single.getRelativeDirPath()).toBe(join(".bob", "settings"));
  });

  it("owns the project file outright: deletable and never merged", () => {
    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({})],
    });
    expect(subagent.isDeletable()).toBe(true);
    expect(subagent.shouldMergeExistingFileContent()).toBe(false);
    expect(
      BobSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "custom_modes.yaml",
      }).isDeletable(),
    ).toBe(true);
  });

  it("never deletes the global file", () => {
    const subagent = BobSubagent.forDeletion({
      outputRoot: testDir,
      relativeDirPath: join(".bob", "settings"),
      relativeFilePath: "custom_modes.yaml",
      global: true,
    });
    expect(subagent.isDeletable()).toBe(false);
  });

  it("merges generated modes into the existing global file by slug", () => {
    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({}), makeSubagent({}, "reviewer.md")],
      global: true,
    });
    expect(subagent.shouldMergeExistingFileContent()).toBe(true);

    subagent.setFileContent(
      [
        "customModes:",
        "  - slug: my-own",
        "    name: My Own",
        "    roleDefinition: Hand-written.",
        "    groups: [read]",
        "    source: global",
        "  - slug: planner",
        "    name: Old Planner",
        "    roleDefinition: Stale.",
        "    groups: [read]",
        "",
      ].join("\n"),
    );

    const modes = (
      loadYaml(subagent.getFileContent()) as { customModes: Record<string, unknown>[] }
    ).customModes;
    expect(modes.map((mode) => mode.slug)).toEqual(["my-own", "planner", "reviewer"]);
    expect(modes[0]).toEqual({
      slug: "my-own",
      name: "My Own",
      roleDefinition: "Hand-written.",
      groups: ["read"],
      source: "global",
    });
    expect(modes[1]?.roleDefinition).toBe("You are a planner.");
  });

  it("refuses to overwrite a global file that is not a customModes document", () => {
    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({})],
      global: true,
    });
    expect(() => subagent.setFileContent("customModes: oops\n")).toThrow(/not overwriting it/);
    expect(() => subagent.setFileContent("customModes: [\n")).toThrow(/not overwriting it/);
  });

  it("imports global-scope custom modes from ~/.bob/settings/custom_modes.yaml", async () => {
    await writeFileContent(
      join(testDir, ".bob", "settings", "custom_modes.yaml"),
      [
        "customModes:",
        "  - slug: reviewer",
        "    name: Reviewer",
        "    roleDefinition: You review code.",
        "    groups:",
        "      - read",
        "",
      ].join("\n"),
    );

    const imported = await BobSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "custom_modes.yaml",
      global: true,
    });

    expect(imported.getRelativeDirPath()).toBe(join(".bob", "settings"));
    const [rulesyncSubagent] = imported.toRulesyncSubagents();
    expect(rulesyncSubagent?.getRelativeFilePath()).toBe("reviewer.md");
    expect(rulesyncSubagent?.getFrontmatter()).toMatchObject({
      targets: ["bob"],
      name: "Reviewer",
      bob: { slug: "reviewer", groups: ["read"] },
    });
  });

  it("defaults groups to Bob's spelling of read/edit/execute/mcp", () => {
    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({ roo: { groups: ["read", "command"] } })],
    });

    expect(loadYaml(subagent.getFileContent())).toEqual({
      customModes: [
        {
          slug: "planner",
          name: "Planner",
          description: "Plans work",
          roleDefinition: "You are a planner.",
          groups: ["read", "edit", "execute", "mcp"],
        },
      ],
    });
  });

  it("reads mode fields from the bob section, not the roo section", () => {
    const subagent = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [
        makeSubagent({
          roo: { slug: "roo-slug", whenToUse: "Roo only" },
          bob: {
            slug: "docs-writer",
            whenToUse: "When writing docs",
            customInstructions: "Be concise.",
            groups: ["read", ["edit", { fileRegex: "\\.md$" }], "skill"],
            allowedSubagents: ["explore"],
          },
        }),
      ],
    });

    expect(subagent.getModes()).toEqual([
      {
        slug: "docs-writer",
        name: "Planner",
        description: "Plans work",
        roleDefinition: "You are a planner.",
        groups: ["read", ["edit", { fileRegex: "\\.md$" }], "skill"],
        whenToUse: "When writing docs",
        customInstructions: "Be concise.",
        allowedSubagents: ["explore"],
      },
    ]);
  });

  it("is targeted only by subagents that target bob", () => {
    expect(BobSubagent.isTargetedByRulesyncSubagent(makeSubagent({}))).toBe(true);
    expect(BobSubagent.isTargetedByRulesyncSubagent(makeSubagent({ targets: ["*"] }))).toBe(true);
    expect(BobSubagent.isTargetedByRulesyncSubagent(makeSubagent({ targets: ["roo"] }))).toBe(
      false,
    );
  });

  it("imports every custom mode back into a bob-targeted rulesync subagent", async () => {
    await writeFileContent(
      join(testDir, ".bob", "custom_modes.yaml"),
      [
        "customModes:",
        "  - slug: docs-writer",
        "    name: Documentation Writer",
        "    description: Writes docs",
        "    roleDefinition: You are a technical writer.",
        "    whenToUse: When writing docs",
        "    groups:",
        "      - read",
        "      - execute",
        "    allowedSubagents:",
        "      - explore",
        "  - slug: reviewer",
        "    name: Reviewer",
        "    roleDefinition: You review code.",
        "    groups:",
        "      - read",
        "",
      ].join("\n"),
    );

    const imported = await BobSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "custom_modes.yaml",
    });
    expect(imported).toBeInstanceOf(BobSubagent);

    const subagents = imported.toRulesyncSubagents();
    expect(subagents.map((subagent) => subagent.getRelativeFilePath())).toEqual([
      "docs-writer.md",
      "reviewer.md",
    ]);
    expect(subagents[0]!.getBody()).toBe("You are a technical writer.");
    expect(subagents[0]!.getFrontmatter()).toEqual({
      targets: ["bob"],
      name: "Documentation Writer",
      description: "Writes docs",
      bob: {
        slug: "docs-writer",
        groups: ["read", "execute"],
        whenToUse: "When writing docs",
        allowedSubagents: ["explore"],
      },
    });
  });

  it("imports a non-list allowedSubagents without failing and does not emit it", async () => {
    await writeFileContent(
      join(testDir, ".bob", "custom_modes.yaml"),
      [
        "customModes:",
        "  - slug: planner",
        "    name: Planner",
        "    roleDefinition: You are a planner.",
        "    allowedSubagents: explore",
        "",
      ].join("\n"),
    );

    const imported = await BobSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "custom_modes.yaml",
    });
    const subagents = imported.toRulesyncSubagents();
    expect((subagents[0]!.getFrontmatter() as Record<string, any>).bob.allowedSubagents).toBe(
      "explore",
    );

    const regenerated = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: subagents,
    });
    expect(regenerated.getModes()[0]).not.toHaveProperty("allowedSubagents");
  });

  it("round-trips a generated file through import", async () => {
    const generated = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [
        makeSubagent({ bob: { groups: ["read", "skill"], allowedSubagents: ["general"] } }),
      ],
    });
    await writeFileContent(join(testDir, ".bob", "custom_modes.yaml"), generated.getFileContent());

    const imported = await BobSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "custom_modes.yaml",
    });
    const regenerated = BobSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: imported.toRulesyncSubagents(),
    });

    expect(regenerated.getFileContent()).toBe(generated.getFileContent());
  });

  it("rejects a custom modes file whose modes miss required fields", async () => {
    await writeFileContent(
      join(testDir, ".bob", "custom_modes.yaml"),
      "customModes:\n  - name: Missing slug and roleDefinition\n",
    );

    await expect(
      BobSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "custom_modes.yaml",
      }),
    ).rejects.toThrow(/Invalid custom modes/);
  });
});
