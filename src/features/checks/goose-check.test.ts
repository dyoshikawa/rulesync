import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ChecksProcessor } from "./checks-processor.js";
import { GooseCheck } from "./goose-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

describe("GooseCheck", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("is a global-only checks target", () => {
    expect(ChecksProcessor.getToolTargets({ global: true })).toContain("goose");
    expect(ChecksProcessor.getToolTargets({ global: false })).not.toContain("goose");
    expect(GooseCheck.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".config", "goose", "checks"),
    );
  });

  it("writes Goose frontmatter with the goose section's model and turn-limit", () => {
    const check = GooseCheck.fromRulesyncCheck({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      global: true,
      rulesyncCheck: new RulesyncCheck({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        relativeFilePath: "security.md",
        frontmatter: {
          targets: ["*"],
          description: "Flags security issues",
          severity: "high",
          tools: ["Read"],
          goose: { model: "gpt-5", "turn-limit": 8 },
        },
        body: "Look for injection vulnerabilities.",
      }),
    });

    expect(check.getFilePath()).toBe(join(testDir, ".config", "goose", "checks", "security.md"));
    expect(check.getFrontmatter()).toEqual({
      name: "security",
      description: "Flags security issues",
      "severity-default": "high",
      tools: ["Read"],
      model: "gpt-5",
      "turn-limit": 8,
    });
  });

  it("imports a global check back with its Goose-only keys", async () => {
    await writeFileContent(
      join(testDir, ".config", "goose", "checks", "perf.md"),
      "---\nname: perf\nseverity-default: low\nmodel: gpt-5\n---\nCheck for N+1 queries.\n",
    );

    const check = await GooseCheck.fromFile({
      outputRoot: testDir,
      relativeFilePath: "perf.md",
      global: true,
    });
    const rulesyncCheck = check.toRulesyncCheck();

    expect(rulesyncCheck.getFrontmatter()).toMatchObject({ severity: "low", model: "gpt-5" });
    expect(rulesyncCheck.getBody()).toContain("Check for N+1 queries.");
  });
});
