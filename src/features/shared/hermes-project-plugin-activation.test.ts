import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, readFileContentOrNull, writeFileContent } from "../../utils/file.js";
import {
  activateHermesProjectPlugins,
  enableHermesProjectPluginsInDotenv,
} from "./hermes-project-plugin-activation.js";
import { parseSharedConfig } from "./shared-config-gateway.js";

const previousHomeDir = process.env.HOME_DIR;

afterEach(() => {
  if (previousHomeDir === undefined) {
    delete process.env.HOME_DIR;
  } else {
    process.env.HOME_DIR = previousHomeDir;
  }
});

describe("Hermes project plugin activation", () => {
  it("normalizes the exact dotenv key without disturbing unrelated content", () => {
    expect(
      enableHermesProjectPluginsInDotenv(
        [
          "# HERMES_ENABLE_PROJECT_PLUGINS=false",
          "TOKEN=secret",
          "export HERMES_ENABLE_PROJECT_PLUGINS=0",
          "HERMES_ENABLE_PROJECT_PLUGINS=false",
          "",
        ].join("\r\n"),
      ),
    ).toBe(
      [
        "# HERMES_ENABLE_PROJECT_PLUGINS=false",
        "TOKEN=secret",
        "export HERMES_ENABLE_PROJECT_PLUGINS=true",
        "",
      ].join("\n"),
    );
  });

  it("adds enabled plugins and the project-plugin environment flag", async () => {
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

      const result = await activateHermesProjectPlugins({
        pluginNames: ["rulesync-ignore", "rulesync-checks"],
        dryRun: false,
        logger: createMockLogger(),
      });

      expect(result).toEqual({
        count: 2,
        paths: [".hermes/config.yaml", ".hermes/.env"],
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
        "TOKEN=secret\nHERMES_ENABLE_PROJECT_PLUGINS=true\n",
      );
    } finally {
      await cleanup();
    }
  });

  it("honors dry-run without writing either user-level file", async () => {
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
      expect(result.paths).toEqual([".hermes/config.yaml", ".hermes/.env"]);
      expect(await readFileContentOrNull(join(testDir, ".hermes", "config.yaml"))).toBeNull();
      expect(await readFileContentOrNull(join(testDir, ".hermes", ".env"))).toBeNull();
      expect(logger.info).toHaveBeenCalledTimes(2);
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
