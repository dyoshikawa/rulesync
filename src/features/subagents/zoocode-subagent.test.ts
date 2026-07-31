import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { subagentsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ZoocodeSubagent } from "./zoocode-subagent.js";

describe("ZoocodeSubagent", () => {
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

  const makeSubagent = (frontmatter: Record<string, unknown>) =>
    new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath: "planner.md",
      frontmatter: {
        targets: ["zoocode"],
        name: "Planner",
        description: "Plans work",
        ...frontmatter,
      } as never,
      body: "You are a planner.",
      validate: true,
    });

  it("emits allowedMcpServers from the zoocode section into the mode", () => {
    const subagent = ZoocodeSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [makeSubagent({ zoocode: { allowedMcpServers: ["github", "jira"] } })],
    });

    const mode = JSON.parse(JSON.stringify(subagent.getModes()[0]));
    expect(mode.allowedMcpServers).toEqual(["github", "jira"]);
  });

  it("returns a ZoocodeSubagent from fromFile so the import overrides apply", async () => {
    await writeFileContent(
      join(testDir, ".roomodes"),
      JSON.stringify({
        customModes: [
          {
            slug: "planner",
            name: "Planner",
            roleDefinition: "You are a planner.",
            allowedMcpServers: ["github"],
          },
        ],
      }),
    );

    const imported = await ZoocodeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: ".roomodes",
    });
    expect(imported).toBeInstanceOf(ZoocodeSubagent);

    const subagents = imported.toRulesyncSubagents();
    const frontmatter = subagents[0]!.getFrontmatter() as Record<string, any>;
    expect(frontmatter.targets).toEqual(["zoocode"]);
    expect(frontmatter.zoocode).toEqual({ allowedMcpServers: ["github"] });
    expect(frontmatter.roo.allowedMcpServers).toBeUndefined();
  });

  it("keeps zoocode after roo in the subagents tuple so its .roomodes aggregate wins", () => {
    const rooIndex = subagentsProcessorToolTargetTuple.indexOf("roo");
    const zoocodeIndex = subagentsProcessorToolTargetTuple.indexOf("zoocode");
    expect(rooIndex).toBeGreaterThanOrEqual(0);
    expect(zoocodeIndex).toBeGreaterThan(rooIndex);
  });
});
