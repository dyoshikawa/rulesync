import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { rulesyncTool } from "./tools.js";

describe("rulesyncTool", () => {
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

  it("handles rule lifecycle through a single tool", async () => {
    const relativePathFromCwd = ".rulesync/rules/sample-rule.md";

    const putResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "put",
      targetPathFromCwd: relativePathFromCwd,
      frontmatter: { description: "Sample" },
      body: "# Rule Body",
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.relativePathFromCwd).toBe(relativePathFromCwd);

    const getResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "get",
      targetPathFromCwd: relativePathFromCwd,
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.body).toContain("Rule Body");

    const listResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "list",
      targetPathFromCwd: ".rulesync/rules",
    });

    const listParsed = JSON.parse(listResult);
    expect(listParsed.rules).toHaveLength(1);
    expect(listParsed.rules[0].relativePathFromCwd).toBe(relativePathFromCwd);

    const deleteResult = await rulesyncTool.execute({
      feature: "rule",
      operation: "delete",
      targetPathFromCwd: relativePathFromCwd,
    });

    const deleteParsed = JSON.parse(deleteResult);
    expect(deleteParsed.relativePathFromCwd).toBe(relativePathFromCwd);
  });

  it("supports MCP content operations", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await ensureDir(rulesyncDir);

    const content = JSON.stringify({
      mcpServers: { sample: { type: "stdio", command: "sample" } },
    });

    const putResult = await rulesyncTool.execute({
      feature: "mcp",
      operation: "put",
      content,
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.content).toContain("sample");

    const getResult = await rulesyncTool.execute({
      feature: "mcp",
      operation: "get",
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.content).toContain("sample");
  });

  it("rejects unsupported feature operations", async () => {
    await expect(
      rulesyncTool.execute({
        feature: "mcp",
        operation: "list",
      }),
    ).rejects.toThrow(/supported operations/i);
  });

  it("validates skill payload through the unified tool", async () => {
    const skillDir = join(testDir, ".rulesync/skills/test-skill");
    await ensureDir(skillDir);
    await writeFileContent(join(skillDir, "helper.txt"), "helper content");

    const putResult = await rulesyncTool.execute({
      feature: "skill",
      operation: "put",
      targetPathFromCwd: ".rulesync/skills/test-skill",
      frontmatter: { name: "test-skill", description: "Skill description", targets: ["*"] },
      body: "Skill body",
      otherFiles: [{ name: "helper.txt", body: "helper content" }],
    });

    const putParsed = JSON.parse(putResult);
    expect(putParsed.otherFiles).toHaveLength(1);

    const getResult = await rulesyncTool.execute({
      feature: "skill",
      operation: "get",
      targetPathFromCwd: ".rulesync/skills/test-skill",
    });

    const getParsed = JSON.parse(getResult);
    expect(getParsed.frontmatter.name).toBe("test-skill");
    expect(getParsed.otherFiles[0].name).toBe("helper.txt");
  });
});
