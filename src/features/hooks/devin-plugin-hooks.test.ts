import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinHooks } from "./devin-hooks.js";
import { DevinPluginHooks } from "./devin-plugin-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("DevinPluginHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("writes the bare event map to hooks.json at the plugin root", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "exec", command: "./scripts/check.sh" }] },
      }),
    });

    const hooks = await DevinPluginHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });
    const projectHooks = await DevinHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });

    expect(hooks).toBeInstanceOf(DevinPluginHooks);
    expect(hooks.getRelativeDirPath()).toBe(".");
    expect(hooks.getRelativeFilePath()).toBe("hooks.json");
    expect(hooks.isDeletable()).toBe(true);
    expect(JSON.parse(hooks.getFileContent())).toEqual(JSON.parse(projectHooks.getFileContent()));
    expect(JSON.parse(hooks.getFileContent())).not.toHaveProperty("hooks");
  });

  it("imports hooks.json back into canonical hooks", async () => {
    await writeFileContent(
      join(testDir, "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          { matcher: "exec", hooks: [{ type: "command", command: "./scripts/check.sh" }] },
        ],
      }),
    );

    const hooks = await DevinPluginHooks.fromFile({ outputRoot: testDir });

    expect(hooks).toBeInstanceOf(DevinPluginHooks);
    expect(hooks.toRulesyncHooks().getJson().hooks.preToolUse).toEqual([
      expect.objectContaining({ matcher: "exec", command: "./scripts/check.sh" }),
    ]);
  });
});
