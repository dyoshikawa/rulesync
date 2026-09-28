import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { GitlabduoHooks } from "./gitlabduo-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function makeRulesyncHooks(testDir: string, config: unknown): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });
}

describe("GitlabduoHooks", () => {
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

  it("uses .gitlab/duo/hooks.json in both scopes", () => {
    const expected = { relativeDirPath: ".gitlab/duo", relativeFilePath: "hooks.json" };
    expect(GitlabduoHooks.getSettablePaths({ global: false })).toEqual(expected);
    expect(GitlabduoHooks.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("emits SessionStart command hooks with matcher and timeout, dropping unsupported events and types", async () => {
    const rulesyncHooks = makeRulesyncHooks(testDir, {
      version: 1,
      hooks: {
        sessionStart: [
          { type: "command", command: "./scripts/context.sh", matcher: "startup", timeout: 10 },
          { type: "prompt", prompt: "ignored" },
        ],
        preToolUse: [{ type: "command", command: "echo pre" }],
      },
    });

    const hooks = await GitlabduoHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
    const parsed = JSON.parse(hooks.getFileContent());

    expect(Object.keys(parsed)).toEqual(["hooks"]);
    expect(Object.keys(parsed.hooks)).toEqual(["SessionStart"]);
    expect(parsed.hooks.SessionStart).toEqual([
      {
        matcher: "startup",
        hooks: [{ type: "command", command: '"$DUO_PROJECT_DIR"/scripts/context.sh', timeout: 10 }],
      },
    ]);
    expect(hooks.isDeletable()).toBe(true);
  });

  it("prefers the gitlabduo override block", async () => {
    const rulesyncHooks = makeRulesyncHooks(testDir, {
      version: 1,
      hooks: { sessionStart: [{ type: "command", command: "echo shared" }] },
      gitlabduo: { hooks: { sessionStart: [{ type: "command", command: "echo duo" }] } },
    });

    const hooks = await GitlabduoHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
    expect(hooks.getFileContent()).toContain("echo duo");
    expect(hooks.getFileContent()).not.toContain("echo shared");
  });

  it("round-trips SessionStart hooks on import", () => {
    const hooks = new GitlabduoHooks({
      outputRoot: testDir,
      relativeDirPath: ".gitlab/duo",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: "resume", hooks: [{ type: "command", command: "echo hi", timeout: 5 }] },
          ],
        },
      }),
    });

    const json = hooks.toRulesyncHooks().getJson();
    expect(json.hooks.sessionStart).toEqual([
      { type: "command", command: "echo hi", matcher: "resume", timeout: 5 },
    ]);
  });
});
