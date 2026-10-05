import { join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { GrokcliIgnore, toGrokcliDenyEntries } from "./grokcli-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

const rulesyncIgnoreOf = (fileContent: string): RulesyncIgnore =>
  new RulesyncIgnore({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
    fileContent,
  });

describe("GrokcliIgnore", () => {
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
    it("should return .grok/sandbox.toml in both scopes", () => {
      const expected = { relativeDirPath: ".grok", relativeFilePath: "sandbox.toml" };
      expect(GrokcliIgnore.getSettablePaths()).toEqual(expected);
      expect(GrokcliIgnore.getSettablePaths({ global: true })).toEqual(expected);
    });
  });

  describe("toGrokcliDenyEntries", () => {
    it.each([
      ["*.pem", ["**/*.pem", "**/*.pem/**"]],
      [".env", ["**/.env", "**/.env/**"]],
      ["tmp", ["**/tmp", "**/tmp/**"]],
      ["tmp/", ["**/tmp/**"]],
      ["/secrets", ["secrets"]],
      ["//secrets", ["secrets"]],
      ["/build/", ["build"]],
      ["config/secrets.json", ["config/secrets.json"]],
      ["certs/**/*.key", ["certs/**/*.key", "certs/**/*.key/**"]],
      ["**/.ssh", ["**/.ssh", "**/.ssh/**"]],
      ["cache/**", ["cache/**"]],
      ["key[0-9].txt", ["**/key[0-9].txt", "**/key[0-9].txt/**"]],
      ["key[!0-9].txt", ["**/key[!0-9].txt", "**/key[!0-9].txt/**"]],
      ["/{draft}.md", ["{draft}.md"]],
    ])("should translate %j to %j", (pattern, entries) => {
      expect(toGrokcliDenyEntries(pattern)).toEqual({ entries });
    });

    it.each([
      ["!keep.env", /negation/],
      ["*.{pem,key}", /brace/],
      ["foo\\ bar*", /backslash/],
      ["a//b", /empty path segments/],
      ["../outside", /`\.` and `\.\.`/],
      ["**.log", /whole path segment/],
      ["logs/foo**", /whole path segment/],
      ["[[:digit:]]", /nested/],
      ["[]a]", /literal `\]`/],
      ["[!]a]", /literal `\]`/],
      ["[^]a]", /literal `\]`/],
      ["key[0-9", /not closed/],
      ["/", /whole workspace/],
    ])("should reject %j", (pattern, reason) => {
      const result = toGrokcliDenyEntries(pattern);
      expect(result.entries).toBeUndefined();
      expect(result.reason).toMatch(reason);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should write the patterns as the deny list of the rulesync profile", async () => {
      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("# secrets\n*.pem\ntmp/\n/secrets\n"),
      });

      expect(grokcliIgnore.getRelativeDirPath()).toBe(".grok");
      expect(grokcliIgnore.getRelativeFilePath()).toBe("sandbox.toml");
      expect(parseToml(grokcliIgnore.getFileContent())).toEqual({
        profiles: {
          rulesync: {
            extends: "workspace",
            deny: ["**/*.pem", "**/*.pem/**", "**/tmp/**", "secrets"],
          },
        },
      });
      expect(grokcliIgnore.getPatterns()).toEqual([
        "**/*.pem",
        "**/*.pem/**",
        "**/tmp/**",
        "secrets",
      ]);
    });

    it("should skip patterns Grok cannot express, with a warning", async () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.env\n!keep.env\n*.{pem,key}\n"),
      });

      expect(parseToml(grokcliIgnore.getFileContent())).toEqual({
        profiles: { rulesync: { extends: "workspace", deny: ["**/*.env", "**/*.env/**"] } },
      });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"!keep.env"'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"*.{pem,key}"'));
    });

    it("should deduplicate patterns that translate to the same entry", async () => {
      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.log\n*.log/\n"),
      });

      expect(grokcliIgnore.getPatterns()).toEqual(["**/*.log", "**/*.log/**"]);
    });

    it("should preserve other profiles, top-level keys and keys added to the rulesync profile", async () => {
      await writeFileContent(
        join(testDir, ".grok", "sandbox.toml"),
        [
          'note = "mine"',
          "",
          "[profiles.mine]",
          'extends = "strict"',
          'deny = ["/data"]',
          "",
          "[profiles.rulesync]",
          'extends = "read-only"',
          "restrict_network = true",
          'deny = ["**/old"]',
          "",
        ].join("\n"),
      );

      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.pem\n"),
      });

      expect(parseToml(grokcliIgnore.getFileContent())).toEqual({
        note: "mine",
        profiles: {
          mine: { extends: "strict", deny: ["/data"] },
          rulesync: {
            extends: "read-only",
            restrict_network: true,
            deny: ["**/*.pem", "**/*.pem/**"],
          },
        },
      });
    });

    it("should keep an existing rulesync profile with an empty deny list when there are no patterns", async () => {
      await writeFileContent(
        join(testDir, ".grok", "sandbox.toml"),
        '[profiles.mine]\ndeny = ["/data"]\n\n[profiles.rulesync]\ndeny = ["**/old"]\n',
      );

      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("# nothing\n"),
      });

      expect(parseToml(grokcliIgnore.getFileContent())).toEqual({
        profiles: { mine: { deny: ["/data"] }, rulesync: { extends: "workspace", deny: [] } },
      });
    });

    it("should not create the rulesync profile when there are no patterns", async () => {
      await writeFileContent(join(testDir, ".grok", "sandbox.toml"), 'note = "mine"\n');

      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("# nothing\n"),
      });

      expect(parseToml(grokcliIgnore.getFileContent())).toEqual({ note: "mine" });
    });

    it("should write nothing for a missing file and no patterns", async () => {
      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf(""),
      });

      expect(grokcliIgnore.getFileContent().trim()).toBe("");
    });

    it("should read the global file from the home-relative path", async () => {
      await writeFileContent(
        join(testDir, ".grok", "sandbox.toml"),
        '[profiles.mine]\ndeny = ["/data"]\n',
      );

      const grokcliIgnore = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.pem\n"),
        global: true,
      });

      expect(grokcliIgnore.getFilePath()).toBe(join(testDir, ".grok", "sandbox.toml"));
      expect(parseToml(grokcliIgnore.getFileContent())).toEqual({
        profiles: {
          mine: { deny: ["/data"] },
          rulesync: { extends: "workspace", deny: ["**/*.pem", "**/*.pem/**"] },
        },
      });
    });

    it("should refuse to overwrite a sandbox file whose profiles key is not a table", async () => {
      await writeFileContent(join(testDir, ".grok", "sandbox.toml"), 'profiles = "mine"\n');

      await expect(
        GrokcliIgnore.fromRulesyncIgnore({
          outputRoot: testDir,
          rulesyncIgnore: rulesyncIgnoreOf("*.pem\n"),
        }),
      ).rejects.toThrow(/to be a table/);
    });

    it("should refuse to overwrite a sandbox file it cannot parse", async () => {
      await writeFileContent(join(testDir, ".grok", "sandbox.toml"), "[profiles\n");

      await expect(
        GrokcliIgnore.fromRulesyncIgnore({
          outputRoot: testDir,
          rulesyncIgnore: rulesyncIgnoreOf("*.pem\n"),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile / toRulesyncIgnore", () => {
    it("should import only the rulesync profile's deny list", async () => {
      await writeFileContent(
        join(testDir, ".grok", "sandbox.toml"),
        [
          "[profiles.mine]",
          'deny = ["mine-only"]',
          "",
          "[profiles.rulesync]",
          "deny = [",
          '  "**/*.pem", "**/*.pem/**", "**/tmp", "**/cache/**", "**/*.log/**", "secrets",',
          '  "config/secrets.json", "/etc/shadow", "!keep", "#note", "**/a/b",',
          "]",
          "",
        ].join("\n"),
      );

      const grokcliIgnore = await GrokcliIgnore.fromFile({ outputRoot: testDir });
      const rulesyncIgnore = grokcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toBe(
        ["*.pem", "tmp", "cache/", "*.log/", "/secrets", "config/secrets.json", "**/a/b"].join(
          "\n",
        ),
      );
    });

    it("should round-trip generated entries back to equivalent patterns", async () => {
      const generated = await GrokcliIgnore.fromRulesyncIgnore({
        outputRoot: testDir,
        rulesyncIgnore: rulesyncIgnoreOf("*.pem\n*.log/\n/secrets\nconfig/app.key\n"),
      });
      await writeFileContent(generated.getFilePath(), generated.getFileContent());

      const imported = await GrokcliIgnore.fromFile({ outputRoot: testDir });

      expect(imported.toRulesyncIgnore().getFileContent()).toBe(
        "*.pem\n*.log/\n/secrets\nconfig/app.key",
      );
      expect(await readFileContent(generated.getFilePath())).toContain("[profiles.rulesync]");
    });

    it("should yield no patterns when the file is missing", async () => {
      const grokcliIgnore = await GrokcliIgnore.fromFile({ outputRoot: testDir });

      expect(grokcliIgnore.getPatterns()).toEqual([]);
      expect(grokcliIgnore.toRulesyncIgnore().getFileContent()).toBe("");
    });
  });

  describe("isDeletable / forDeletion", () => {
    it("should never be deletable because the file holds user profiles", () => {
      const grokcliIgnore = GrokcliIgnore.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".grok",
        relativeFilePath: "sandbox.toml",
      });

      expect(grokcliIgnore.isDeletable()).toBe(false);
    });
  });
});
