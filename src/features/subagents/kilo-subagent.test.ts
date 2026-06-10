import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiloSubagent, KiloSubagentFrontmatterSchema } from "./kilo-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("KiloSubagent", () => {
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

  it("should return settable paths for project and global scopes", () => {
    expect(KiloSubagent.getSettablePaths()).toEqual({
      relativeDirPath: ".kilo/agents",
    });

    expect(KiloSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "kilo", "agents"),
    });
  });

  it("should create a RulesyncSubagent with kilo section and subagent mode", () => {
    const subagent = new KiloSubagent({
      outputRoot: testDir,
      relativeDirPath: ".kilo/agents",
      relativeFilePath: "review.md",
      frontmatter: {
        description: "Reviews code",
        mode: "subagent",
        temperature: 0.2,
      },
      body: "Review the provided changes",
      fileContent: "",
      validate: true,
    });

    const rulesync = subagent.toRulesyncSubagent();
    expect(rulesync.getFrontmatter()).toEqual({
      targets: ["*"],
      name: "review",
      description: "Reviews code",
      kilo: {
        temperature: 0.2,
        mode: "subagent",
      },
    });
    expect(rulesync.getBody()).toBe("Review the provided changes");
  });

  it("should build Kilo subagent from Rulesync subagent and preserve mode", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "docs-writer.md",
      frontmatter: {
        targets: ["kilo"],
        name: "docs-writer",
        description: "Writes documentation",
        kilo: {
          mode: "primary", // should be preserved
          model: "model-x",
        },
      },
      body: "Document the APIs",
      validate: false,
    });

    const toolSubagent = KiloSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiloSubagent;

    expect(toolSubagent).toBeInstanceOf(KiloSubagent);
    expect(toolSubagent.getFrontmatter()).toEqual({
      name: "docs-writer",
      description: "Writes documentation",
      model: "model-x",
      mode: "primary",
    });
    expect(toolSubagent.getRelativeDirPath()).toBe(join(".config", "kilo", "agents"));
  });

  it("should build Kilo subagent with default mode 'all' when not specified", () => {
    // Kilo's documented default for user-defined agents is `all` (available
    // both as a top-level pick AND as a subagent). See:
    // https://kilo.ai/docs/customize/custom-modes
    // Previously rulesync defaulted to "subagent", which hid generated
    // agents from the Kilo agent picker.
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "docs-writer.md",
      frontmatter: {
        targets: ["kilo"],
        name: "docs-writer",
        description: "Writes documentation",
        kilo: {
          model: "model-x",
        },
      },
      body: "Document the APIs",
      validate: false,
    });

    const toolSubagent = KiloSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiloSubagent;

    expect(toolSubagent).toBeInstanceOf(KiloSubagent);
    expect(toolSubagent.getFrontmatter()).toEqual({
      name: "docs-writer",
      description: "Writes documentation",
      model: "model-x",
      mode: "all",
    });
    expect(toolSubagent.getRelativeDirPath()).toBe(join(".config", "kilo", "agents"));
  });

  it("should still honour explicit kilo.mode = 'subagent' override", () => {
    // Users who want the old behavior (hidden, subagent-only) can opt in
    // by setting `kilo: { mode: subagent }` in source frontmatter.
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "hidden-helper.md",
      frontmatter: {
        targets: ["kilo"],
        name: "hidden-helper",
        description: "Subagent-only helper",
        kilo: {
          mode: "subagent",
        },
      },
      body: "Body",
      validate: false,
    });

    const toolSubagent = KiloSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiloSubagent;

    expect(toolSubagent.getFrontmatter().mode).toBe("subagent");
  });

  it("should preserve explicit kilo.mode = 'all' with other Kilo-specific fields", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "explicit-all.md",
      frontmatter: {
        targets: ["kilo"],
        name: "explicit-all",
        description: "Explicitly all mode",
        kilo: {
          mode: "all",
          temperature: 0.4,
        },
      },
      body: "Body",
      validate: false,
    });

    const toolSubagent = KiloSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiloSubagent;

    expect(toolSubagent.getFrontmatter()).toMatchObject({
      mode: "all",
      temperature: 0.4,
    });
  });

  it("should preserve primary mode for Kilo subagent", () => {
    // Regression test for: kilo.mode was hardcoded to 'subagent' instead of being preserved
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "primary-agent.md",
      frontmatter: {
        targets: ["*"],
        name: "primary-agent",
        description: "A primary mode agent",
        kilo: {
          mode: "primary",
          hidden: false,
          tools: {
            bash: true,
            edit: true,
          },
        },
      },
      body: "Test body for primary agent",
      validate: false,
    });

    const toolSubagent = KiloSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiloSubagent;

    expect(toolSubagent.getFrontmatter().mode).toBe("primary");
    expect(toolSubagent.getFrontmatter().name).toBe("primary-agent");
    expect(toolSubagent.getFrontmatter().tools).toEqual({
      bash: true,
      edit: true,
    });
  });

  it("should load from file and validate frontmatter", async () => {
    const dirPath = join(testDir, ".kilo", "agents");
    const filePath = join(dirPath, "general.md");

    await writeFileContent(
      filePath,
      `---
description: General purpose helper
mode: subagent
temperature: 0.1
---
Assist with any tasks`,
    );

    const subagent = await KiloSubagent.fromFile({
      relativeFilePath: "general.md",
    });

    expect(subagent.getFrontmatter()).toEqual({
      description: "General purpose helper",
      mode: "subagent",
      temperature: 0.1,
    });
    expect(subagent.getBody()).toBe("Assist with any tasks");
  });

  it("should expose schema for direct validation", () => {
    const result = KiloSubagentFrontmatterSchema.safeParse({
      description: "Valid agent",
      mode: "subagent",
    });

    expect(result.success).toBe(true);
  });

  it("should apply default mode 'all' when mode is omitted", async () => {
    const dirPath = join(testDir, ".kilo", "agents");
    const filePath = join(dirPath, "no-mode.md");

    await writeFileContent(
      filePath,
      `---
description: Agent without explicit mode
temperature: 0.5
---
Body content`,
    );

    const subagent = await KiloSubagent.fromFile({
      relativeFilePath: "no-mode.md",
    });

    expect(subagent.getFrontmatter().mode).toBe("all");
  });

  it("should fail validation on invalid schema types", () => {
    const result = KiloSubagentFrontmatterSchema.safeParse({
      mode: "subagent",
      temperature: "hot", // invalid: should be number
    });
    expect(result.success).toBe(false);
  });

  it("should throw during fromFile on invalid schema types", async () => {
    const dirPath = join(testDir, ".kilo", "agents");
    const filePath = join(dirPath, "invalid-type.md");

    await writeFileContent(
      filePath,
      `---
temperature: "hot"
---
Body content`,
    );

    await expect(
      KiloSubagent.fromFile({
        relativeFilePath: "invalid-type.md",
      }),
    ).rejects.toThrow("Invalid input: expected number, received string");
  });

  it("should preserve custom mode value when explicitly set", async () => {
    const dirPath = join(testDir, ".kilo", "agents");
    const filePath = join(dirPath, "custom-mode.md");

    await writeFileContent(
      filePath,
      `---
description: Agent with custom mode
mode: all
---
Body content`,
    );

    const subagent = await KiloSubagent.fromFile({
      relativeFilePath: "custom-mode.md",
    });

    expect(subagent.getFrontmatter().mode).toBe("all");
  });

  it("should accept and expose all explicit Kilo frontmatter fields", async () => {
    const dirPath = join(testDir, ".kilo", "agents");
    const filePath = join(dirPath, "full-fields.md");

    await writeFileContent(
      filePath,
      `---
description: Full featured agent
mode: subagent
name: full-fields
displayName: Full Fields Agent
deprecated: false
native: false
hidden: true
top_p: 0.9
temperature: 0.7
color: "#ff0000"
permission: read-only
model: claude-3-5-sonnet
variant: fast
prompt: You are a helpful assistant
disable: false
---
Agent body`,
    );

    const subagent = await KiloSubagent.fromFile({
      relativeFilePath: "full-fields.md",
    });

    const fm = subagent.getFrontmatter();
    expect(fm.displayName).toBe("Full Fields Agent");
    expect(fm.deprecated).toBe(false);
    expect(fm.native).toBe(false);
    expect(fm.hidden).toBe(true);
    expect(fm.top_p).toBe(0.9);
    expect(fm.temperature).toBe(0.7);
    expect(fm.color).toBe("#ff0000");
    expect(fm.permission).toBe("read-only");
    expect(fm.model).toBe("claude-3-5-sonnet");
    expect(fm.variant).toBe("fast");
    expect(fm.prompt).toBe("You are a helpful assistant");
    expect(fm.disable).toBe(false);
  });

  it("should pass through explicit Kilo fields via fromRulesyncSubagent", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "full-kilo.md",
      frontmatter: {
        targets: ["kilo"],
        name: "full-kilo",
        description: "Agent with all Kilo fields",
        kilo: {
          mode: "subagent",
          displayName: "Full Kilo",
          deprecated: false,
          native: false,
          hidden: true,
          top_p: 0.95,
          temperature: 0.3,
          color: "blue",
          permission: "write",
          model: "gpt-4o",
          variant: "default",
          prompt: "Be concise",
          disable: false,
        },
      },
      body: "Kilo agent body",
      validate: false,
    });

    const toolSubagent = KiloSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as KiloSubagent;

    const fm = toolSubagent.getFrontmatter();
    expect(fm.displayName).toBe("Full Kilo");
    expect(fm.deprecated).toBe(false);
    expect(fm.native).toBe(false);
    expect(fm.hidden).toBe(true);
    expect(fm.top_p).toBe(0.95);
    expect(fm.temperature).toBe(0.3);
    expect(fm.color).toBe("blue");
    expect(fm.permission).toBe("write");
    expect(fm.model).toBe("gpt-4o");
    expect(fm.variant).toBe("default");
    expect(fm.prompt).toBe("Be concise");
    expect(fm.disable).toBe(false);
  });

  it("should validate schema accepts all explicit Kilo fields", () => {
    const result = KiloSubagentFrontmatterSchema.safeParse({
      description: "Agent",
      mode: "subagent",
      displayName: "My Agent",
      deprecated: true,
      native: false,
      hidden: false,
      top_p: 0.8,
      temperature: 0.5,
      color: "green",
      permission: "read",
      model: "claude-sonnet-4",
      variant: "extended",
      prompt: "Think carefully",
      options: { key: "value" },
      steps: [{ name: "step1" }],
      disable: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("My Agent");
      expect(result.data.deprecated).toBe(true);
      expect(result.data.top_p).toBe(0.8);
      expect(result.data.steps).toEqual([{ name: "step1" }]);
      expect(result.data.options).toEqual({ key: "value" });
    }
  });

  it("should accept a per-tool permission object as well as a string", () => {
    const stringResult = KiloSubagentFrontmatterSchema.safeParse({
      name: "agent",
      permission: "read-only",
    });
    expect(stringResult.success).toBe(true);

    const objectResult = KiloSubagentFrontmatterSchema.safeParse({
      name: "agent",
      permission: {
        bash: { allow: ["git *"], deny: ["rm -rf *"] },
        edit: { ask: ["src/**"] },
      },
    });
    expect(objectResult.success).toBe(true);
    if (objectResult.success) {
      expect(objectResult.data.permission).toEqual({
        bash: { allow: ["git *"], deny: ["rm -rf *"] },
        edit: { ask: ["src/**"] },
      });
    }
  });

  it("should round-trip the options and steps fields via fromRulesyncSubagent", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "with-steps.md",
      frontmatter: {
        targets: ["kilo"],
        name: "with-steps",
        description: "Agent with options/steps",
        kilo: {
          options: { temperature: 0.2 },
          steps: [{ name: "step1" }, { name: "step2" }],
        },
      },
      body: "Body",
      validate: false,
    });

    const fm = (
      KiloSubagent.fromRulesyncSubagent({
        rulesyncSubagent,
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      }) as KiloSubagent
    ).getFrontmatter();
    expect(fm.options).toEqual({ temperature: 0.2 });
    expect(fm.steps).toEqual([{ name: "step1" }, { name: "step2" }]);
  });

  describe("forDeletion", () => {
    it("should create a deletable placeholder with the default mode", () => {
      const subagent = KiloSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".kilo/agents",
        relativeFilePath: "obsolete.md",
      });
      expect(subagent.isDeletable()).toBe(true);
      expect(subagent.getBody()).toBe("");
      expect(subagent.getFrontmatter().mode).toBe("all");
    });

    it("should preserve the global flag passthrough (regression for #1639)", () => {
      const subagent = KiloSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".config", "kilo", "agents"),
        relativeFilePath: "obsolete.md",
        global: true,
      });
      expect((subagent as unknown as { global: boolean }).global).toBe(true);
    });
  });
});
