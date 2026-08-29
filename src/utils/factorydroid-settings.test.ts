import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFactorydroidSettingsWithLocalOverlay } from "./factorydroid-settings.js";
import { writeFileContent } from "./file.js";

describe("readFactorydroidSettingsWithLocalOverlay", () => {
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

  const read = (): Promise<string | null> =>
    readFactorydroidSettingsWithLocalOverlay({
      outputRoot: testDir,
      relativeDirPath: ".factory",
      baseFileName: "settings.json",
    });

  const writeBase = (json: unknown): Promise<void> =>
    writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify(json));

  const writeLocal = (json: unknown): Promise<void> =>
    writeFileContent(join(testDir, ".factory", "settings.local.json"), JSON.stringify(json));

  it("should return null when neither file exists", async () => {
    expect(await read()).toBeNull();
  });

  it("should return the base content unchanged when there is no local file", async () => {
    await writeBase({ commandAllowlist: ["ls"] });

    expect(JSON.parse((await read())!)).toEqual({ commandAllowlist: ["ls"] });
  });

  it("should let local keys replace base keys at the top level", async () => {
    await writeBase({ commandAllowlist: ["ls"], commandDenylist: ["rm *"] });
    await writeLocal({ commandAllowlist: ["git status"] });

    expect(JSON.parse((await read())!)).toEqual({
      // Replaced wholesale, not concatenated: Droid documents an override.
      commandAllowlist: ["git status"],
      commandDenylist: ["rm *"],
    });
  });

  it("should read a local file that has no base beside it", async () => {
    await writeLocal({ commandDenylist: ["curl *"] });

    expect(JSON.parse((await read())!)).toEqual({ commandDenylist: ["curl *"] });
  });

  it("should drop prototype-pollution keys from the local file", async () => {
    await writeBase({ commandAllowlist: ["ls"] });
    await writeFileContent(
      join(testDir, ".factory", "settings.local.json"),
      '{"__proto__":{"polluted":true},"commandDenylist":["rm *"]}',
    );

    const merged = JSON.parse((await read())!);
    expect(merged).toEqual({ commandAllowlist: ["ls"], commandDenylist: ["rm *"] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("should throw when the local file is not valid JSON", async () => {
    await writeBase({});
    await writeFileContent(join(testDir, ".factory", "settings.local.json"), "{ not json");

    await expect(read()).rejects.toThrow(/Failed to parse Factory Droid settings/);
  });

  it("should throw when the local file is not a JSON object", async () => {
    await writeBase({});
    await writeFileContent(join(testDir, ".factory", "settings.local.json"), "[1, 2]");

    await expect(read()).rejects.toThrow(/expected a JSON object/);
  });

  it("should return the raw base content when the base file is malformed", async () => {
    await writeFileContent(join(testDir, ".factory", "settings.json"), "{ not json");
    await writeLocal({ commandAllowlist: ["ls"] });

    // The caller's own parse reports the error, keeping its message.
    expect(await read()).toBe("{ not json");
  });
});
