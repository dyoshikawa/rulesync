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
      relativeDirPath: ".kilo/agent",
    });

    expect(KiloSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "kilo", "agent"),
    });
  });

  it("should create a RulesyncSubagent with kilo section and subagent mode", () => {
    const subagent = new KiloSubagent({
      outputRoot: testDir,
      relativeDirPath: ".kilo/agent",
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
    expect(toolSubagent.getRelativeDirPath()).toBe(join(".config", "kilo", "agent"));
  });

  it("should build Kilo subagent with default mode 'all' when not specified", () => {
    // Kilo's documented default for user-defined agents is `all` (available
    // both as a top-level pick AND as a subagent). See:
    // https://kilocode.ai/docs/customize/custom-modes
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
    expect(toolSubagent.getRelativeDirPath()).toBe(join(".config", "kilo", "agent"));
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

  it("should honour explicit kilo.mode = 'all' override (matches default)", () => {
    // Symmetry test: explicit `kilo.mode: all` matches the new default but
    // is a valid explicit value. Guards against any future regression
    // where the defaulting logic accidentally overrides user intent.
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

    expect(toolSubagent.getFrontmatter().mode).toBe("all");
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
    const dirPath = join(testDir, ".kilo", "agent");
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

  it("should apply default mode 'subagent' when mode is omitted", async () => {
    const dirPath = join(testDir, ".kilo", "agent");
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

    expect(subagent.getFrontmatter().mode).toBe("subagent");
  });

  it("should preserve custom mode value when explicitly set", async () => {
    const dirPath = join(testDir, ".kilo", "agent");
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
});
