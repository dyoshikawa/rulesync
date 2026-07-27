import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, readFileContentOrNull, writeFileContent } from "../../utils/file.js";
import { activateHermesProjectPlugins } from "./hermes-project-plugin-activation.js";
import { parseSharedConfig } from "./shared-config-gateway.js";

const previousHomeDir = process.env.HOME_DIR;
const previousHermesHome = process.env.HERMES_HOME;

beforeEach(() => {
  delete process.env.HERMES_HOME;
});

afterEach(() => {
  if (previousHomeDir === undefined) {
    delete process.env.HOME_DIR;
  } else {
    process.env.HOME_DIR = previousHomeDir;
  }
  if (previousHermesHome === undefined) {
    delete process.env.HERMES_HOME;
  } else {
    process.env.HERMES_HOME = previousHermesHome;
  }
});

describe("Hermes project plugin activation", () => {
  it("adds enabled plugins without changing the global project-plugin trust gate", async () => {
    const { testDir, cleanup } = await setupTestDirectory({ home: true });
    process.env.HOME_DIR = testDir;
    try {
      await writeFileContent(
        join(testDir, ".hermes", "config.yaml"),
        [
          "model: hermes-3",
          "plugins:",
          "  enabled:",
          "    - existing-plugin",
          "  settings:",
          "    existing-plugin:",
          "      option: true",
          "",
        ].join("\n"),
      );
      await writeFileContent(
        join(testDir, ".hermes", ".env"),
        "TOKEN=secret\nHERMES_ENABLE_PROJECT_PLUGINS=false\n",
      );

      const logger = createMockLogger();
      const result = await activateHermesProjectPlugins({
        pluginNames: ["rulesync-ignore", "rulesync-checks"],
        dryRun: false,
        logger,
      });

      expect(result).toEqual({
        count: 1,
        paths: [".hermes/config.yaml"],
        hasDiff: true,
      });
      expect(
        parseSharedConfig({
          format: "yaml",
          fileContent: await readFileContent(join(testDir, ".hermes", "config.yaml")),
        }),
      ).toEqual({
        model: "hermes-3",
        plugins: {
          enabled: ["existing-plugin", "rulesync-ignore", "rulesync-checks"],
          settings: { "existing-plugin": { option: true } },
        },
      });
      expect(await readFileContent(join(testDir, ".hermes", ".env"))).toBe(
        "TOKEN=secret\nHERMES_ENABLE_PROJECT_PLUGINS=false\n",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("HERMES_ENABLE_PROJECT_PLUGINS=true"),
      );
    } finally {
      await cleanup();
    }
  });

  it("honors dry-run without writing the user-level config", async () => {
    const { testDir, cleanup } = await setupTestDirectory({ home: true });
    process.env.HOME_DIR = testDir;
    try {
      const logger = createMockLogger();
      const result = await activateHermesProjectPlugins({
        pluginNames: ["rulesync-subagents"],
        dryRun: true,
        logger,
      });

      expect(result.hasDiff).toBe(true);
      expect(result.paths).toEqual([".hermes/config.yaml"]);
      expect(await readFileContentOrNull(join(testDir, ".hermes", "config.yaml"))).toBeNull();
      expect(await readFileContentOrNull(join(testDir, ".hermes", ".env"))).toBeNull();
      expect(logger.info).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("writes activation to the active HERMES_HOME profile", async () => {
    const { testDir, cleanup } = await setupTestDirectory({ home: true });
    const profileDir = join(testDir, "profiles", "reviewer");
    delete process.env.HOME_DIR;
    process.env.HERMES_HOME = profileDir;
    try {
      const result = await activateHermesProjectPlugins({
        pluginNames: ["rulesync-subagents"],
        dryRun: false,
        logger: createMockLogger(),
      });

      expect(result).toEqual({
        count: 1,
        paths: ["config.yaml"],
        hasDiff: true,
      });
      expect(await readFileContent(join(profileDir, "config.yaml"))).toContain(
        "rulesync-subagents",
      );
      expect(await readFileContentOrNull(join(testDir, ".hermes", "config.yaml"))).toBeNull();
      expect(await readFileContentOrNull(join(profileDir, ".env"))).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("refuses to override an explicit plugin disable", async () => {
    const { testDir, cleanup } = await setupTestDirectory({ home: true });
    process.env.HOME_DIR = testDir;
    try {
      await writeFileContent(
        join(testDir, ".hermes", "config.yaml"),
        "plugins:\n  disabled:\n    - rulesync-ignore\n",
      );

      await expect(
        activateHermesProjectPlugins({
          pluginNames: ["rulesync-ignore"],
          dryRun: false,
          logger: createMockLogger(),
        }),
      ).rejects.toThrow(/rulesync-ignore.*plugins\.disabled/);
    } finally {
      await cleanup();
    }
  });
});
