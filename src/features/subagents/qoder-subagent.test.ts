import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { QoderSubagent } from "./qoder-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("QoderSubagent", () => {
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

  it("should use .qoder/agents for both scopes", () => {
    expect(QoderSubagent.getSettablePaths().relativeDirPath).toBe(join(".qoder", "agents"));
    expect(QoderSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder", "agents"),
    );
  });

  it("should write name, description and the qoder section", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "api-reviewer.md",
      frontmatter: {
        targets: ["*"],
        name: "api-reviewer",
        description: "Review API designs",
        qoder: { tools: "Read,Grep,Glob", model: "inherit", name: "ignored" },
      },
      body: "You are an API reviewer.",
      validate: true,
    });

    const subagent = QoderSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent,
    }) as QoderSubagent;

    expect(subagent.getFrontmatter()).toEqual({
      name: "api-reviewer",
      description: "Review API designs",
      tools: "Read,Grep,Glob",
      model: "inherit",
    });
    expect(subagent.getFileContent()).toContain("You are an API reviewer.");
  });

  it("should import a subagent and keep extra fields in the qoder section", async () => {
    await writeFileContent(
      join(testDir, ".qoder", "agents", "reviewer.md"),
      "---\nname: api-reviewer\ndescription: Review APIs\ntools: [Read, Grep]\nmaxTurns: 8\n---\n\nPrompt\n",
    );

    const subagent = await QoderSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "reviewer.md",
    });

    expect(subagent.getImportIdentity()).toBe("api-reviewer");
    expect(subagent.toRulesyncSubagent().getFrontmatter()).toEqual({
      targets: ["*"],
      name: "api-reviewer",
      description: "Review APIs",
      qoder: { tools: ["Read", "Grep"], maxTurns: 8 },
    });
  });
});
