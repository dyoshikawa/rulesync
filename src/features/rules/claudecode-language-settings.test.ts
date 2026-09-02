import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDECODE_SETTINGS_SCHEMA_URL } from "../../constants/claudecode-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeLanguageSettings } from "./claudecode-language-settings.js";

describe("ClaudecodeLanguageSettings", () => {
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

  describe("getSettablePaths", () => {
    it("targets the local settings file at project scope", () => {
      expect(ClaudecodeLanguageSettings.getSettablePaths()).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.local.json",
      });
    });

    it("targets the user settings file at global scope, which has no local twin", () => {
      expect(ClaudecodeLanguageSettings.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("fromLanguage", () => {
    it("creates the settings document with the Claude Code language value", async () => {
      const file = await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: testDir,
        language: "ja",
      });

      expect(file.getRelativeDirPath()).toBe(".claude");
      expect(file.getRelativeFilePath()).toBe("settings.local.json");
      expect(JSON.parse(file.getFileContent())).toEqual({
        $schema: CLAUDECODE_SETTINGS_SCHEMA_URL,
        language: "japanese",
      });
      expect(file.validate()).toEqual({ success: true, error: null });
    });

    it("uses the multi-word Claude Code value for region-qualified codes", async () => {
      const file = await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: testDir,
        language: "zh-TW",
      });
      expect(JSON.parse(file.getFileContent()).language).toBe("traditional chinese");
    });

    it("patches language into an existing file without touching other keys", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.local.json"),
        JSON.stringify(
          {
            permissions: { allow: ["Bash(git *)"], deny: ["Read(.env)"] },
            hooks: { PreToolUse: [] },
            language: "french",
            model: "opus",
          },
          null,
          2,
        ),
      );

      const file = await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: testDir,
        language: "ko",
      });

      expect(JSON.parse(file.getFileContent())).toEqual({
        $schema: CLAUDECODE_SETTINGS_SCHEMA_URL,
        permissions: { allow: ["Bash(git *)"], deny: ["Read(.env)"] },
        hooks: { PreToolUse: [] },
        language: "korean",
        model: "opus",
      });
    });

    it("writes ~/.claude/settings.json at global scope", async () => {
      const file = await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: testDir,
        language: "de",
        global: true,
      });
      expect(file.getRelativeFilePath()).toBe("settings.json");
      expect(JSON.parse(file.getFileContent()).language).toBe("german");
    });

    it("is never swept as an orphan", async () => {
      const file = await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: testDir,
        language: "es",
      });
      expect(file.isDeletable()).toBe(false);
    });
  });
});
