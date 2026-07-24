import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroCliSubagent } from "./kiro-cli-subagent.js";

describe("KiroCliSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should import with the kiro-cli target and derive an omitted name", async () => {
    await writeFileContent(
      join(testDir, ".kiro", "agents", "planner.json"),
      JSON.stringify({
        description: "Plans tasks",
        prompt: "Break down tasks into steps.",
      }),
    );

    const subagent = await KiroCliSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "planner.json",
    });
    const rulesyncSubagent = subagent.toRulesyncSubagent();

    expect(subagent).toBeInstanceOf(KiroCliSubagent);
    expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
      targets: ["kiro-cli"],
      name: "planner",
      description: "Plans tasks",
    });
  });
});
