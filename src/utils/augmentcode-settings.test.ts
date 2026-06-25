import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readAugmentcodeSettingsWithLocalOverlay } from "./augmentcode-settings.js";
import { ensureDir, writeFileContent } from "./file.js";

describe("readAugmentcodeSettingsWithLocalOverlay", () => {
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

  const writeSettings = async (name: string, value: unknown) => {
    const dir = join(testDir, ".augment");
    await ensureDir(dir);
    await writeFileContent(join(dir, name), JSON.stringify(value));
  };

  it("returns the base content when the local overrides file is absent", async () => {
    await writeSettings("settings.json", { toolPermissions: ["base"] });

    const content = await readAugmentcodeSettingsWithLocalOverlay({
      outputRoot: testDir,
      relativeDirPath: ".augment",
      baseFileName: "settings.json",
      baseFallbackContent: "{}",
      includeLocalOverlay: true,
    });

    expect(JSON.parse(content)).toEqual({ toolPermissions: ["base"] });
  });

  it("returns the fallback content when settings.json is absent", async () => {
    const content = await readAugmentcodeSettingsWithLocalOverlay({
      outputRoot: testDir,
      relativeDirPath: ".augment",
      baseFileName: "settings.json",
      baseFallbackContent: '{"hooks":{}}',
      includeLocalOverlay: true,
    });

    expect(content).toBe('{"hooks":{}}');
  });

  it("shallow-merges settings.local.json over settings.json (local wins)", async () => {
    await writeSettings("settings.json", {
      toolPermissions: ["base"],
      recommendedMarketplaces: ["keep"],
    });
    await writeSettings("settings.local.json", { toolPermissions: ["local"] });

    const content = await readAugmentcodeSettingsWithLocalOverlay({
      outputRoot: testDir,
      relativeDirPath: ".augment",
      baseFileName: "settings.json",
      baseFallbackContent: "{}",
      includeLocalOverlay: true,
    });

    expect(JSON.parse(content)).toEqual({
      // Local wins for overlapping keys.
      toolPermissions: ["local"],
      // Base-only keys are preserved.
      recommendedMarketplaces: ["keep"],
    });
  });

  it("ignores the local overlay when includeLocalOverlay is false", async () => {
    await writeSettings("settings.json", { toolPermissions: ["base"] });
    await writeSettings("settings.local.json", { toolPermissions: ["local"] });

    const content = await readAugmentcodeSettingsWithLocalOverlay({
      outputRoot: testDir,
      relativeDirPath: ".augment",
      baseFileName: "settings.json",
      baseFallbackContent: "{}",
      includeLocalOverlay: false,
    });

    expect(JSON.parse(content)).toEqual({ toolPermissions: ["base"] });
  });

  it("throws when settings.local.json is not valid JSON", async () => {
    await writeSettings("settings.json", { toolPermissions: [] });
    await ensureDir(join(testDir, ".augment"));
    await writeFileContent(join(testDir, ".augment", "settings.local.json"), "{ not json");

    await expect(
      readAugmentcodeSettingsWithLocalOverlay({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        baseFileName: "settings.json",
        baseFallbackContent: "{}",
        includeLocalOverlay: true,
      }),
    ).rejects.toThrow(/Failed to parse AugmentCode settings/);
  });

  it("throws when settings.local.json is not a JSON object", async () => {
    await writeSettings("settings.json", { toolPermissions: [] });
    await ensureDir(join(testDir, ".augment"));
    await writeFileContent(join(testDir, ".augment", "settings.local.json"), "[1, 2, 3]");

    await expect(
      readAugmentcodeSettingsWithLocalOverlay({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        baseFileName: "settings.json",
        baseFallbackContent: "{}",
        includeLocalOverlay: true,
      }),
    ).rejects.toThrow(/expected a JSON object/);
  });
});
