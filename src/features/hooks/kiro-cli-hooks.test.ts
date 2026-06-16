import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { KiroCliHooks } from "./kiro-cli-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("KiroCliHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("honors the kiro-cli override key and ignores the legacy kiro override", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: "/mock",
      relativeDirPath: ".rulesync",
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        hooks: { sessionStart: [{ command: "echo shared" }] },
        // Legacy kiro override must NOT leak into kiro-cli output.
        kiro: { hooks: { stop: [{ command: "echo legacy-kiro" }] } },
        // kiro-cli override must be applied.
        "kiro-cli": { hooks: { stop: [{ command: "echo kiro-cli" }] } },
      }),
    });

    const hooks = await KiroCliHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: true,
    });

    const parsed = JSON.parse(hooks.getFileContent());
    // Shared hook still present (mapped to Kiro CLI event name).
    expect(parsed.hooks.agentSpawn?.[0]?.command).toBe("echo shared");
    // `stop` carries the kiro-cli override, not the legacy kiro one.
    expect(parsed.hooks.stop?.[0]?.command).toBe("echo kiro-cli");
  });
});
