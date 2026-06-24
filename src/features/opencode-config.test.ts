import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import {
  asOpencodeEntries,
  getOpencodeConfigDir,
  readOpencodeConfig,
  resolveOpencodeFileTemplate,
} from "./opencode-config.js";

describe("opencode-config", () => {
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

  describe("readOpencodeConfig", () => {
    it("parses opencode.json", async () => {
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ mcp: { a: 1 } }));
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({ mcp: { a: 1 } });
    });

    it("prefers opencode.jsonc and tolerates comments", async () => {
      await writeFileContent(join(testDir, "opencode.jsonc"), '{\n  // a comment\n  "x": 1\n}');
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ x: 2 }));
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({ x: 1 });
    });

    it("returns an empty object when no config exists", async () => {
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({});
    });

    it("returns an empty object when the config is not an object", async () => {
      await writeFileContent(join(testDir, "opencode.json"), "[1, 2, 3]");
      expect(await readOpencodeConfig({ outputRoot: testDir })).toEqual({});
    });
  });

  describe("asOpencodeEntries", () => {
    it("returns the record for plain objects", () => {
      expect(asOpencodeEntries({ a: { template: "x" } })).toEqual({ a: { template: "x" } });
    });

    it("returns null for non-objects, arrays, and null", () => {
      expect(asOpencodeEntries(null)).toBeNull();
      expect(asOpencodeEntries([1, 2])).toBeNull();
      expect(asOpencodeEntries("str")).toBeNull();
      expect(asOpencodeEntries(undefined)).toBeNull();
    });
  });

  describe("getOpencodeConfigDir", () => {
    it("uses the project root in project mode and ~/.config/opencode in global mode", () => {
      expect(getOpencodeConfigDir({ outputRoot: testDir })).toBe(testDir);
      expect(getOpencodeConfigDir({ outputRoot: testDir, global: true })).toBe(
        join(testDir, ".config", "opencode"),
      );
    });
  });

  describe("resolveOpencodeFileTemplate", () => {
    it("resolves a whole-value {file:./path} reference relative to configDir", async () => {
      await writeFileContent(join(testDir, "prompts", "p.txt"), "file body");
      expect(
        await resolveOpencodeFileTemplate({
          value: "{file:./prompts/p.txt}",
          configDir: testDir,
        }),
      ).toBe("file body");
    });

    it("returns the value unchanged when it is not a file reference", async () => {
      expect(await resolveOpencodeFileTemplate({ value: "plain prompt", configDir: testDir })).toBe(
        "plain prompt",
      );
    });

    it("preserves the literal value when the referenced file is unreadable", async () => {
      expect(
        await resolveOpencodeFileTemplate({ value: "{file:./nope.txt}", configDir: testDir }),
      ).toBe("{file:./nope.txt}");
    });
  });
});
