import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { MimocodeHooks } from "./mimocode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("MimocodeHooks", () => {
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

  it("should resolve project and global plugin paths under the mimocode dirs", () => {
    expect(MimocodeHooks.getSettablePaths()).toEqual({
      relativeDirPath: join(".mimocode", "plugins"),
      relativeFilePath: "rulesync-hooks.js",
    });
    expect(MimocodeHooks.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".config", "mimocode", "plugins"),
    );
  });

  it("should merge the mimocode hooks section and ignore the opencode one", () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ command: "shared.sh" }] },
        mimocode: { hooks: { stop: [{ command: "mimocode-only.sh" }] } },
        opencode: { hooks: { stop: [{ command: "opencode-only.sh" }] } },
      }),
      validate: false,
    });

    const hooks = MimocodeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: false,
    });

    expect(hooks).toBeInstanceOf(MimocodeHooks);
    const content = hooks.getFileContent();
    expect(content).toContain("export const RulesyncHooksPlugin");
    expect(content).toContain("shared.sh");
    expect(content).toContain("mimocode-only.sh");
    expect(content).not.toContain("opencode-only.sh");
  });

  it("warns that a failClosed: true is ignored on every event but preToolUse", () => {
    const logger = createMockLogger();
    const warnSpy = vi.spyOn(logger, "warn");
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [{ command: "guard.sh", failClosed: true }],
          postToolUse: [{ command: "format.sh", failClosed: false }],
        },
        mimocode: { hooks: { sessionStart: [{ command: "init.sh", failClosed: true }] } },
        // Another target's section is not merged, so its value is never warned about.
        opencode: { hooks: { stop: [{ command: "audit.sh", failClosed: true }] } },
      }),
      validate: false,
    });

    MimocodeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, logger });

    expect(warnSpy.mock.calls).toEqual([
      [
        'failClosed on "sessionStart" hook will be ignored — the generated MiMo Code plugin only supports failClosed on preToolUse',
      ],
    ]);
    // A dropped `false` is the plugin's own behavior there, so it is not warned about.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('"postToolUse"'));
  });
});
