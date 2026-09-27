import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { PROCESSOR_REGISTRY } from "../types/processor-registry.js";
import { PACKAGING_TOOL_TARGETS } from "../types/tool-targets.js";
import { ensureDir, writeFileContent } from "./file.js";
import { assertPluginRootSafe } from "./plugin-root.js";

describe("assertPluginRootSafe", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("rejects missing package roots", async () => {
    await expect(
      assertPluginRootSafe({
        toolTarget: "claudecode-plugin",
        outputRoot: join(testDir, "plugin"),
      }),
    ).rejects.toThrow("must be an existing directory");
  });

  it("does not apply package-root restrictions to ordinary targets", async () => {
    const filePath = join(testDir, "not-a-directory");
    await writeFileContent(filePath, "content");

    await expect(
      assertPluginRootSafe({
        toolTarget: "claudecode",
        outputRoot: filePath,
      }),
    ).resolves.toBeUndefined();
  });

  describe.skipIf(process.platform === "win32")("symbolic links", () => {
    it("rejects a package root that is a symbolic link", async () => {
      const actualRoot = join(testDir, "actual");
      const pluginRoot = join(testDir, "plugin");
      await ensureDir(actualRoot);
      await symlink(actualRoot, pluginRoot);

      await expect(
        assertPluginRootSafe({
          toolTarget: "claudecode-plugin",
          outputRoot: pluginRoot,
        }),
      ).rejects.toThrow("Expected a directory");
    });

    it("rejects symbolic links anywhere in a package tree", async () => {
      const pluginRoot = join(testDir, "plugin");
      const outsideFile = join(testDir, "secret.txt");
      await ensureDir(join(pluginRoot, "skills", "review"));
      await writeFileContent(outsideFile, "secret");
      await symlink(outsideFile, join(pluginRoot, "skills", "review", "secret.txt"));

      await expect(
        assertPluginRootSafe({
          toolTarget: "antigravity-plugin",
          outputRoot: pluginRoot,
        }),
      ).rejects.toThrow("tree containing a symbolic link");
    });
  });
});

describe("packaging targets in global mode", () => {
  // `generate --global` and `import --global` skip the plugin root safety check
  // for packaging targets because it would walk the whole home directory. That
  // is only safe while no feature can write a packaging target in global mode.
  it.each(PROCESSOR_REGISTRY.map((entry) => [entry.feature, entry.processor] as const))(
    "the %s processor supports no packaging target in global mode",
    (_feature, processor) => {
      const globalTargets = [
        ...processor.getToolTargets({ global: true }),
        ...processor.getToolTargets({ global: true, importOnly: true }),
      ];
      for (const target of PACKAGING_TOOL_TARGETS) {
        expect(globalTargets).not.toContain(target);
      }
    },
  );
});
