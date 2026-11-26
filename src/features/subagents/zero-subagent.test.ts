import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ZeroSubagent } from "./zero-subagent.js";

function makeRulesyncSubagent(frontmatter: Record<string, unknown>): RulesyncSubagent {
  return new RulesyncSubagent({
    outputRoot: "/mock",
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath: "api-review.md",
    frontmatter: { targets: ["*"], ...frontmatter } as never,
    body: "Review API changes.",
    validate: true,
  });
}

describe("ZeroSubagent", () => {
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

  describe("getSettablePaths", () => {
    it("should use .zero/specialists in project scope", () => {
      expect(ZeroSubagent.getSettablePaths().relativeDirPath).toBe(join(".zero", "specialists"));
    });

    it.each([
      ["linux", join(".config", "zero", "specialists")],
      ["darwin", join(".config", "zero", "specialists")],
      ["win32", join("AppData", "Roaming", "zero", "specialists")],
    ] as const)("should use the %s user specialists dir in global scope", (platform, expected) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(ZeroSubagent.getSettablePaths({ global: true }).relativeDirPath).toBe(expected);
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should write name, description and the zero section, with tools as a list", () => {
      const subagent = ZeroSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: makeRulesyncSubagent({
          name: "api-review",
          description: "Reviews API changes",
          claudecode: { model: "sonnet" },
          zero: { tools: "read-only, plan", reasoningEffort: "high", color: "blue" },
        }),
      });

      expect(subagent.getRelativeFilePath()).toBe("api-review.md");
      expect(subagent.getFileContent()).toBe(
        [
          "---",
          "name: api-review",
          "description: Reviews API changes",
          "reasoningEffort: high",
          "tools:",
          "  - read-only",
          "  - plan",
          "---",
          "Review API changes.",
          "",
        ].join("\n"),
      );
    });

    it("should keep a long description on one line", () => {
      const description = `${"word ".repeat(40)}end`;
      const subagent = ZeroSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: makeRulesyncSubagent({ name: "api-review", description }),
      });
      expect(subagent.getFileContent()).toContain(`description: ${description}\n`);
    });

    it("should warn about a name or description Zero rejects", () => {
      const logger = createMockLogger();
      ZeroSubagent.fromRulesyncSubagent({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        rulesyncSubagent: makeRulesyncSubagent({ name: "API Review" }),
        logger,
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe("fromFile / toRulesyncSubagent", () => {
    it("should import Zero keys into the zero section", async () => {
      await writeFileContent(
        join(testDir, ".zero", "specialists", "api-review.md"),
        "---\nname: api-review\ndescription: Reviews\ntools: [read-only, plan]\nmodel: m\n---\n\nPrompt.\n",
      );

      const subagent = await ZeroSubagent.fromFile({
        outputRoot: testDir,
        relativeFilePath: "api-review.md",
      });
      const rulesync = subagent.toRulesyncSubagent();

      expect(rulesync.getFrontmatter()).toEqual({
        targets: ["*"],
        name: "api-review",
        description: "Reviews",
        zero: { tools: ["read-only", "plan"], model: "m" },
      });
      expect(rulesync.getBody()).toBe("Prompt.");
    });
  });
});
