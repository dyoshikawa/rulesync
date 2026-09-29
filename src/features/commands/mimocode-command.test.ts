import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { MimocodeCommand } from "./mimocode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("MimocodeCommand", () => {
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

  it("should resolve project and global settable paths under the mimocode dirs", () => {
    expect(MimocodeCommand.getSettablePaths().relativeDirPath).toBe(join(".mimocode", "commands"));
    expect(MimocodeCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".config", "mimocode", "commands"),
    );
  });

  it("should read the mimocode section and round-trip it on import", () => {
    const frontmatter = {
      targets: ["mimocode" as const],
      description: "Analyze coverage",
      mimocode: { subtask: true },
      opencode: { agent: "ignored" },
    };
    const rulesyncCommand = new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "custom.md",
      frontmatter,
      body: "Analyze coverage details",
      fileContent: stringifyFrontmatter("Analyze coverage details", frontmatter),
    });

    const command = MimocodeCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });

    expect(command).toBeInstanceOf(MimocodeCommand);
    expect(command.getFrontmatter()).toEqual({ description: "Analyze coverage", subtask: true });
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Analyze coverage",
      mimocode: { subtask: true },
    });
  });
});
