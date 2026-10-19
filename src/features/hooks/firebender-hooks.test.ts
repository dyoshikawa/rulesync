import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderHooks } from "./firebender-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function makeRulesyncHooks({
  outputRoot,
  config,
}: {
  outputRoot: string;
  config: Record<string, unknown>;
}): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot,
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
  });
}

describe("FirebenderHooks", () => {
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

  it("should use .firebender/hooks.json in both scopes", () => {
    for (const global of [false, true]) {
      expect(FirebenderHooks.getSettablePaths({ global })).toEqual({
        relativeDirPath: ".firebender",
        relativeFilePath: "hooks.json",
      });
    }
  });

  it("should write supported command hooks in Firebender's { version, hooks } layout", async () => {
    const hooks = await FirebenderHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: makeRulesyncHooks({
        outputRoot: testDir,
        config: {
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", command: ".firebender/hooks/start.sh" }],
            beforeShellExecution: [
              { command: "./approve.sh", timeout: 30, matcher: "curl|wget", loop_limit: 3 },
            ],
            preToolUse: [{ type: "prompt", prompt: "Is this safe?" }],
            // Not a Firebender event: dropped.
            beforeSubmitPrompt: [{ command: "./submit.sh" }],
          },
        },
      }),
    });

    expect(JSON.parse(hooks.getFileContent())).toEqual({
      version: 1,
      hooks: {
        sessionStart: [{ command: ".firebender/hooks/start.sh" }],
        beforeShellExecution: [
          { command: "./approve.sh", timeout: 30, loop_limit: 3, matcher: "curl|wget" },
        ],
      },
    });
  });

  it("should apply the firebender override block on top of the shared hooks", async () => {
    const hooks = await FirebenderHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: makeRulesyncHooks({
        outputRoot: testDir,
        config: {
          hooks: { stop: [{ command: "./shared.sh" }] },
          firebender: { hooks: { stop: [{ command: "./firebender.sh" }] } },
        },
      }),
    });

    expect(JSON.parse(hooks.getFileContent()).hooks).toEqual({
      stop: [{ command: "./firebender.sh" }],
    });
  });

  it("should import .firebender/hooks.json into canonical hooks", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          afterFileEdit: [{ command: ".firebender/hooks/format.sh" }],
          preToolUse: [{ command: "./validate.sh", matcher: "Shell|Read" }],
        },
      }),
    );

    const hooks = await FirebenderHooks.fromFile({ outputRoot: testDir });
    const json = hooks.toRulesyncHooks().getJson();

    expect(json.hooks).toEqual({
      afterFileEdit: [{ command: ".firebender/hooks/format.sh" }],
      preToolUse: [{ command: "./validate.sh", matcher: "Shell|Read" }],
    });
    expect(json.version).toBe(1);
  });
});
