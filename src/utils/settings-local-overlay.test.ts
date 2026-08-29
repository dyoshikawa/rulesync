import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "./file.js";
import { readSettingsWithLocalOverlay } from "./settings-local-overlay.js";

describe("readSettingsWithLocalOverlay", () => {
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

  // Records what the caller's merge saw, so the shared half can be tested
  // without committing to either tool's layering semantics.
  const read = ({
    baseFallbackContent,
    sensitiveKeys,
    logger,
  }: {
    baseFallbackContent?: string;
    sensitiveKeys?: readonly string[];
    logger?: ReturnType<typeof createMockLogger>;
  } = {}): Promise<string | null> =>
    readSettingsWithLocalOverlay({
      outputRoot: testDir,
      relativeDirPath: ".tool",
      baseFileName: "settings.json",
      localFileName: "settings.local.json",
      toolLabel: "Test Tool",
      ...(baseFallbackContent !== undefined && { baseFallbackContent }),
      ...(sensitiveKeys !== undefined && { sensitiveKeys }),
      ...(logger !== undefined && { logger }),
      merge: (base, local) => ({ ...base, ...local, merged: true }),
    });

  const write = (fileName: string, content: string): Promise<void> =>
    writeFileContent(join(testDir, ".tool", fileName), content);

  it("should return null when neither file exists and no fallback is given", async () => {
    expect(await read()).toBeNull();
  });

  it("should return the fallback when neither file exists", async () => {
    expect(await read({ baseFallbackContent: '{"hooks":{}}' })).toBe('{"hooks":{}}');
  });

  it("should return the base content untouched when there is no local file", async () => {
    await write("settings.json", '{"a":1}');

    // Not re-serialized: the caller's own parse sees exactly what is on disk.
    expect(await read()).toBe('{"a":1}');
  });

  it("should hand both tiers to the caller's merge", async () => {
    await write("settings.json", '{"a":1}');
    await write("settings.local.json", '{"b":2}');

    expect(JSON.parse((await read())!)).toEqual({ a: 1, b: 2, merged: true });
  });

  it("should merge the fallback when only the local file exists", async () => {
    await write("settings.local.json", '{"b":2}');

    expect(JSON.parse((await read({ baseFallbackContent: '{"a":1}' }))!)).toEqual({
      a: 1,
      b: 2,
      merged: true,
    });
  });

  it("should name the tool when the local file cannot be parsed", async () => {
    await write("settings.local.json", "{ not json");

    await expect(read()).rejects.toThrow(/Failed to parse Test Tool settings/);
  });

  it("should reject a local file that is not a JSON object", async () => {
    await write("settings.local.json", "[1, 2]");

    await expect(read()).rejects.toThrow(/expected a JSON object/);
  });

  it("should return the raw base content when the base cannot be used", async () => {
    await write("settings.local.json", '{"b":2}');

    await write("settings.json", "{ not json");
    expect(await read()).toBe("{ not json");

    await write("settings.json", "[1, 2]");
    expect(await read()).toBe("[1, 2]");
  });

  it("should name what the machine-local file contributed", async () => {
    await write("settings.json", '{"a":1}');
    await write("settings.local.json", '{"maxAutonomyLevel":"high"}');
    const logger = createMockLogger();

    await read({ logger });

    // An import writes to `.rulesync/`, which is committed, so a value that was
    // personal to one machine must not slip into the team's config unnoticed.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"maxAutonomyLevel"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("settings.local.json"));
  });

  it("should name it once however many features read the same pair", async () => {
    await write("settings.json", '{"a":1}');
    await write("settings.local.json", '{"maxAutonomyLevel":"high"}');
    const logger = createMockLogger();

    // One `import` reads this pair once per feature — permissions, hooks, MCP.
    await read({ logger });
    await read({ logger });

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("should say what a guardrail key taken from the local file would become", async () => {
    await write("settings.json", "{}");
    await write("settings.local.json", '{"editor":"vim","sandbox":{"bash":"off"}}');
    const logger = createMockLogger();

    await read({ sensitiveKeys: ["sandbox"], logger });

    // Publishing a sandbox somebody switched off for their own machine hands
    // the relaxed value to everyone, so it is named beyond the plain key list.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('"sandbox" decides what Test Tool is allowed to do'),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"editor"'));
  });

  it("should keep the guardrail sentence out when no such key was read", async () => {
    await write("settings.json", "{}");
    await write("settings.local.json", '{"editor":"vim"}');
    const logger = createMockLogger();

    await read({ sensitiveKeys: ["sandbox"], logger });

    expect(logger.warn).toHaveBeenCalledWith(expect.not.stringContaining("is allowed to do"));
  });

  it("should stay quiet when there is no local file", async () => {
    await write("settings.json", '{"a":1}');
    const logger = createMockLogger();

    await read({ logger });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should strip control characters from the key it names", async () => {
    await write("settings.json", "{}");
    await write("settings.local.json", '{"a\\u001b[31mb":1}');
    const logger = createMockLogger();

    await read({ logger });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"a[31mb"'));
  });
});
