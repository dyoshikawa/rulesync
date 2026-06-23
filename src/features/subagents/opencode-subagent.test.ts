import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OpenCodeSubagent, OpenCodeSubagentFrontmatterSchema } from "./opencode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("OpenCodeSubagent", () => {
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
    expect(OpenCodeSubagent.getSettablePaths()).toEqual({
      relativeDirPath: ".opencode/agents",
    });

    expect(OpenCodeSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "opencode", "agents"),
    });
  });

  it("should create a RulesyncSubagent with opencode section and subagent mode", () => {
    const subagent = new OpenCodeSubagent({
      outputRoot: testDir,
      relativeDirPath: ".opencode/agents",
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
      opencode: {
        temperature: 0.2,
        mode: "subagent",
      },
    });
    expect(rulesync.getBody()).toBe("Review the provided changes");
  });

  it("should build OpenCode subagent from Rulesync subagent and preserve mode", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "docs-writer.md",
      frontmatter: {
        targets: ["opencode"],
        name: "docs-writer",
        description: "Writes documentation",
        opencode: {
          mode: "primary", // should be preserved
          model: "model-x",
        },
      },
      body: "Document the APIs",
      validate: false,
    });

    const toolSubagent = OpenCodeSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as OpenCodeSubagent;

    expect(toolSubagent).toBeInstanceOf(OpenCodeSubagent);
    expect(toolSubagent.getFrontmatter()).toEqual({
      name: "docs-writer",
      description: "Writes documentation",
      model: "model-x",
      mode: "primary",
    });
    expect(toolSubagent.getRelativeDirPath()).toBe(join(".config", "opencode", "agents"));
  });

  it("should build OpenCode subagent with default mode when not specified", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "docs-writer.md",
      frontmatter: {
        targets: ["opencode"],
        name: "docs-writer",
        description: "Writes documentation",
        opencode: {
          model: "model-x",
        },
      },
      body: "Document the APIs",
      validate: false,
    });

    const toolSubagent = OpenCodeSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as OpenCodeSubagent;

    expect(toolSubagent).toBeInstanceOf(OpenCodeSubagent);
    expect(toolSubagent.getFrontmatter()).toEqual({
      name: "docs-writer",
      description: "Writes documentation",
      model: "model-x",
      mode: "subagent",
    });
    expect(toolSubagent.getRelativeDirPath()).toBe(join(".config", "opencode", "agents"));
  });

  it("should preserve primary mode for OpenCode subagent", () => {
    // Regression test for: opencode.mode was hardcoded to 'subagent' instead of being preserved
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "primary-agent.md",
      frontmatter: {
        targets: ["*"],
        name: "primary-agent",
        description: "A primary mode agent",
        opencode: {
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

    const toolSubagent = OpenCodeSubagent.fromRulesyncSubagent({
      rulesyncSubagent,
      global: true,
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    }) as OpenCodeSubagent;

    expect(toolSubagent.getFrontmatter().mode).toBe("primary");
    expect(toolSubagent.getFrontmatter().name).toBe("primary-agent");
    expect(toolSubagent.getFrontmatter().tools).toEqual({
      bash: true,
      edit: true,
    });
  });

  it("should load from file and validate frontmatter", async () => {
    const dirPath = join(testDir, ".opencode", "agents");
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

    const subagent = await OpenCodeSubagent.fromFile({
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
    const result = OpenCodeSubagentFrontmatterSchema.safeParse({
      description: "Valid agent",
      mode: "subagent",
    });

    expect(result.success).toBe(true);
  });

  it("should validate the documented field types but keep unknown fields (looseObject)", () => {
    // Known fields are now typed explicitly (strict-schema pattern, #1658)...
    expect(
      OpenCodeSubagentFrontmatterSchema.safeParse({
        description: "Agent",
        temperature: 0.4,
        top_p: 0.9,
        model: "some-model",
        tools: { read: true, write: false },
      }).success,
    ).toBe(true);
    // ...a wrong type for a declared field is rejected...
    expect(
      OpenCodeSubagentFrontmatterSchema.safeParse({
        description: "Agent",
        temperature: "hot",
      }).success,
    ).toBe(false);
    // ...while forward-compatible unknown fields still round-trip.
    const loose = OpenCodeSubagentFrontmatterSchema.safeParse({
      description: "Agent",
      futureOpenCodeField: "kept",
    });
    expect(loose.success).toBe(true);
    expect(loose.success && (loose.data as Record<string, unknown>).futureOpenCodeField).toBe(
      "kept",
    );
  });

  it("should apply default mode 'subagent' when mode is omitted", async () => {
    const dirPath = join(testDir, ".opencode", "agents");
    const filePath = join(dirPath, "no-mode.md");

    await writeFileContent(
      filePath,
      `---
description: Agent without explicit mode
temperature: 0.5
---
Body content`,
    );

    const subagent = await OpenCodeSubagent.fromFile({
      relativeFilePath: "no-mode.md",
    });

    expect(subagent.getFrontmatter().mode).toBe("subagent");
  });

  it("should preserve custom mode value when explicitly set", async () => {
    const dirPath = join(testDir, ".opencode", "agents");
    const filePath = join(dirPath, "custom-mode.md");

    await writeFileContent(
      filePath,
      `---
description: Agent with custom mode
mode: all
---
Body content`,
    );

    const subagent = await OpenCodeSubagent.fromFile({
      relativeFilePath: "custom-mode.md",
    });

    expect(subagent.getFrontmatter().mode).toBe("all");
  });

  describe("forDeletion", () => {
    it("should create a deletable placeholder", () => {
      const subagent = OpenCodeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".opencode/agents",
        relativeFilePath: "obsolete.md",
      });
      expect(subagent.isDeletable()).toBe(true);
      expect(subagent.getBody()).toBe("");
    });

    it("should preserve the global flag passthrough (regression for #1639)", () => {
      const subagent = OpenCodeSubagent.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".config", "opencode", "agents"),
        relativeFilePath: "obsolete.md",
        global: true,
      });
      expect((subagent as unknown as { global: boolean }).global).toBe(true);
    });
  });
});
