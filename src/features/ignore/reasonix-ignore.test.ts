import { join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { ReasonixIgnore } from "./reasonix-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

const rulesyncIgnoreOf = (fileContent: string): RulesyncIgnore =>
  new RulesyncIgnore({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
    fileContent,
  });

describe("ReasonixIgnore", () => {
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
    it("should return the project config file by default", () => {
      expect(ReasonixIgnore.getSettablePaths()).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
      });
    });

    it("should return the global config file for global scope", () => {
      expect(ReasonixIgnore.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".reasonix",
        relativeFilePath: "config.toml",
      });
    });
  });

  describe("constructor", () => {
    it("should read patterns from the permissions deny table", () => {
      const ignore = new ReasonixIgnore({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: '[permissions]\ndeny = ["Read(*.log)", "Bash(rm *)"]\n',
      });

      expect(ignore.getPatterns()).toEqual(["Read(*.log)", "Bash(rm *)"]);
    });

    it("should tolerate a file without a permissions table", () => {
      const ignore = new ReasonixIgnore({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: '[[plugins]]\nname = "example"\n',
      });

      expect(ignore.getPatterns()).toEqual([]);
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable because the file is shared", () => {
      const ignore = ReasonixIgnore.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
      });

      expect(ignore.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("warns when generate would shadow a nested .reasonix/reasonix.toml", async () => {
      await writeFileContent(join(testDir, ".reasonix", "reasonix.toml"), "");
      const logger = createMockLogger();

      await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.log\n"),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(String(logger.warn.mock.calls[0]?.[0])).toContain("Reasonix ignore:");
    });

    it("should write read_file(...) deny entries into the project config", async () => {
      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.log\n# comment\nnode_modules/**\n"),
      });

      expect(ignore.getRelativeDirPath()).toBe(".");
      expect(ignore.getRelativeFilePath()).toBe("reasonix.toml");
      expect(parseToml(ignore.getFileContent())).toEqual({
        permissions: { deny: ["read_file(*.log)", "read_file(node_modules/**)"] },
      });
    });

    it("should preserve unrelated tables and non-read deny entries", async () => {
      const filePath = join(testDir, "reasonix.toml");
      await writeFileContent(
        filePath,
        [
          "[[plugins]]",
          'name = "example"',
          "",
          "[permissions]",
          'mode = "ask"',
          'allow = ["Bash(npm run build)"]',
          'deny = ["Bash(rm *)", "read_file(stale.txt)"]',
          "",
        ].join("\n"),
      );

      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("secrets/**\n"),
      });

      expect(parseToml(ignore.getFileContent())).toEqual({
        plugins: [{ name: "example" }],
        permissions: {
          mode: "ask",
          allow: ["Bash(npm run build)"],
          deny: ["Bash(rm *)", "read_file(secrets/**)"],
        },
      });
    });

    it("should not add an empty permissions table for an empty ignore file", async () => {
      const filePath = join(testDir, "reasonix.toml");
      await writeFileContent(filePath, '[[plugins]]\nname = "example"\n');

      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf(""),
      });

      expect(ignore.getFileContent()).not.toContain("[permissions]");
    });

    it("should write the global config file for global scope", async () => {
      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.env\n"),
        global: true,
      });

      expect(ignore.getRelativeDirPath()).toBe(".reasonix");
      expect(ignore.getRelativeFilePath()).toBe("config.toml");
      expect(parseToml(ignore.getFileContent())).toEqual({
        permissions: { deny: ["read_file(*.env)"] },
      });
    });

    it("should replace legacy Read(...) denies, which match no Reasonix tool", async () => {
      await writeFileContent(
        join(testDir, "reasonix.toml"),
        '[permissions]\ndeny = ["Read(.env)", "Bash(rm *)", "read_file(stale.txt)"]\n',
      );

      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf(".env\n"),
      });

      expect(parseToml(ignore.getFileContent())).toEqual({
        permissions: { deny: ["Bash(rm *)", "read_file(.env)"] },
      });
    });

    it("should produce a file that round-trips back to the same patterns", async () => {
      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.log\nsecrets/**\n"),
      });
      await writeFileContent(join(testDir, "reasonix.toml"), ignore.getFileContent());

      const loaded = await ReasonixIgnore.fromFile({ outputRoot: testDir });

      expect(loaded.toRulesyncIgnore().getFileContent()).toBe("*.log\nsecrets/**");
    });
  });

  describe("fromFile", () => {
    it("should fall back to an empty document when the config does not exist", async () => {
      const ignore = await ReasonixIgnore.fromFile({ outputRoot: testDir });

      expect(ignore.getPatterns()).toEqual([]);
    });

    it("should read the global config file for global scope", async () => {
      await ensureDir(join(testDir, ".reasonix"));
      await writeFileContent(
        join(testDir, ".reasonix", "config.toml"),
        '[permissions]\ndeny = ["Read(*.env)"]\n',
      );

      const ignore = await ReasonixIgnore.fromFile({ outputRoot: testDir, global: true });

      expect(ignore.getPatterns()).toEqual(["Read(*.env)"]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should keep only read deny entries and strip the wrapper", () => {
      const ignore = new ReasonixIgnore({
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent:
          '[permissions]\ndeny = ["read_file(*.log)", "Bash(rm *)", "read_file()", "Read(*.env)", "Read(*.log)"]\n',
      });

      // Legacy `Read(...)` entries from an older rulesync still import.
      expect(ignore.toRulesyncIgnore().getFileContent()).toBe("*.log\n*.env");
    });
  });

  describe("write round trip", () => {
    it("should be writable to disk as valid TOML", async () => {
      const ignore = await ReasonixIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("dist/**\n"),
      });
      const filePath = join(testDir, "reasonix.toml");
      await writeFileContent(filePath, ignore.getFileContent());

      expect(parseToml(await readFileContent(filePath))).toEqual({
        permissions: { deny: ["read_file(dist/**)"] },
      });
    });
  });
});
