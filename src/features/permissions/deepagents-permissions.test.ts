import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import { DeepagentsPermissions } from "./deepagents-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(config: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(config),
  });
}

function tableOf(tomlContent: string, key: string): Record<string, unknown> {
  const parsed = smolToml.parse(tomlContent);
  return isRecord(parsed[key]) ? parsed[key] : {};
}

function allowListOf(tomlContent: string): unknown {
  return tableOf(tomlContent, "shell").allow_list;
}

describe("DeepagentsPermissions", () => {
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

  const generate = async ({
    config,
    logger,
  }: {
    config: Record<string, unknown>;
    logger?: ReturnType<typeof createMockLogger>;
  }): Promise<string> => {
    const permissions = await DeepagentsPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissions(config),
      global: true,
      ...(logger !== undefined && { logger }),
    });
    return permissions.getFileContent();
  };

  const importFrom = (tomlContent: string): Record<string, unknown> => {
    const permissions = new DeepagentsPermissions({
      outputRoot: testDir,
      relativeDirPath: ".deepagents",
      relativeFilePath: "config.toml",
      fileContent: tomlContent,
      validate: false,
      global: true,
    });
    return JSON.parse(permissions.toRulesyncPermissions().getFileContent());
  };

  describe("getSettablePaths", () => {
    it("targets the user config, which lives beside the agent directory", () => {
      const paths = DeepagentsPermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".deepagents");
      expect(paths.relativeFilePath).toBe("config.toml");
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (config.toml holds every dcode setting)", () => {
      const permissions = new DeepagentsPermissions({
        relativeDirPath: ".deepagents",
        relativeFilePath: "config.toml",
        fileContent: "",
        validate: false,
      });
      expect(permissions.isDeletable()).toBe(false);
    });
  });

  describe("global-only", () => {
    it("fromRulesyncPermissions throws without global", async () => {
      await expect(
        DeepagentsPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ permission: { bash: { "git *": "allow" } } }),
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("fromFile throws without global", async () => {
      await expect(DeepagentsPermissions.fromFile({ outputRoot: testDir })).rejects.toThrow(
        /global-only/,
      );
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("writes bash allow rules as executable names", async () => {
      const content = await generate({
        config: { permission: { bash: { "git *": "allow", ls: "allow" } } },
      });

      expect(allowListOf(content)).toEqual(["git", "ls"]);
    });

    it("reduces a pattern that carries arguments and says it widened the rule", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "git commit:*": "allow" } } },
        logger,
      });

      // dcode matches the executable name only, so `git push` is auto-approved
      // too now. Silently narrowing to nothing would be worse, but this is a
      // real widening and has to be visible.
      expect(allowListOf(content)).toEqual(["git"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("were widened"));
    });

    it("treats a trailing `:*` on the executable as 'any arguments'", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "git:*": "allow" } } },
        logger,
      });

      expect(allowListOf(content)).toEqual(["git"]);
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("were widened"));
    });

    it("emits the `all` sentinel alone for the wildcard pattern, and warns", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "*": "allow", "git *": "allow" } } },
        logger,
      });

      // Upstream rejects the whole option when `all` shares the list, so the
      // otherwise-redundant `git` entry must not be written beside it.
      expect(allowListOf(content)).toEqual(["all"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("skips its dangerous-pattern check"),
      );
    });

    it("skips a pattern whose executable token still holds a glob", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "npm-*": "allow", ls: "allow" } } },
        logger,
      });

      // Written verbatim it would match no command, which reads as an allow
      // rule that quietly does nothing.
      expect(allowListOf(content)).toEqual(["ls"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("were therefore skipped"));
    });

    it("skips a pattern that reduces to a sentinel name", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "recommended *": "allow", ls: "allow" } } },
        logger,
      });

      // `recommended` would splice in a list rulesync did not author.
      expect(allowListOf(content)).toEqual(["ls"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("as sentinels"));
    });

    it("reports bash deny rules it cannot represent", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "rm *": "deny", ls: "allow" } } },
        logger,
      });

      expect(allowListOf(content)).toEqual(["ls"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("has no command denylist"));
    });

    it("writes nothing for `ask` rules, which are already the default", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "curl *": "ask" } } },
        logger,
      });

      expect(smolToml.parse(content).shell).toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("reports deny rules of categories it does not model", async () => {
      const logger = createMockLogger();

      await generate({
        config: { permission: { read: { ".env": "deny" } } },
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'read' deny rules"));
    });

    it("merges into an existing config.toml and leaves unrelated tables alone", async () => {
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        '[models]\ndefault = "anthropic:claude-opus-4"\n\n[shell]\ntimeout = 120\nallow_list = ["cat"]\n',
      );

      const content = await generate({
        config: { permission: { bash: { "git *": "allow" } } },
      });

      const parsed = smolToml.parse(content);
      expect(isRecord(parsed.models) ? parsed.models.default : undefined).toBe(
        "anthropic:claude-opus-4",
      );
      expect(tableOf(content, "shell").timeout).toBe(120);
      // The allowlist itself is rulesync-owned, so it is replaced rather than
      // added to.
      expect(allowListOf(content)).toEqual(["git"]);
    });

    it("drops the allowlist when nothing maps, without leaving an empty table", async () => {
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        '[shell]\nallow_list = ["cat"]\n',
      );

      const content = await generate({ config: { permission: {} } });

      expect(smolToml.parse(content).shell).toBeUndefined();
    });

    it("keeps the rest of [shell] when only the allowlist is dropped", async () => {
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        '[shell]\nallow_list = ["cat"]\ntimeout = 120\n',
      );

      const content = await generate({ config: { permission: {} } });

      expect(tableOf(content, "shell")).toEqual({ timeout: 120 });
    });

    it("does not create the config file as a side effect of generating", async () => {
      await generate({ config: { permission: { bash: { "git *": "allow" } } } });

      // `fromRulesyncPermissions` only builds the content; nothing should have
      // been written to the user's home directory by reading it.
      const permissions = await DeepagentsPermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });
      expect(permissions.getFileContent()).toBe("");
    });

    it("merges the deepagents override's startup keys", async () => {
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        '[startup]\nrecent = "auto"\n',
      );

      const content = await generate({
        config: {
          permission: {},
          deepagents: { startup: { mode: "auto", yolo_switcher: false } },
        },
      });

      expect(tableOf(content, "startup")).toEqual({
        recent: "auto",
        mode: "auto",
        yolo_switcher: false,
      });
    });

    it("treats the `*:*` spelling of the wildcard as the wildcard", async () => {
      const content = await generate({ config: { permission: { bash: { "*:*": "allow" } } } });

      expect(allowListOf(content)).toEqual(["all"]);
    });

    it("refuses to write `all` when the config also denies commands", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "*": "allow", "rm -rf *": "deny" } } },
        logger,
      });

      // `all` would switch off the dangerous-pattern check as well, leaving the
      // user with less than dcode's own default in the name of a deny rule.
      expect(smolToml.parse(content).shell).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not written as allow_list"),
      );
    });

    it("warns when a deny rule's executable ends up auto-approved anyway", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "git *": "allow", "git push": "deny" } } },
        logger,
      });

      expect(allowListOf(content)).toEqual(["git"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("are not merely unenforced"),
      );
      // The generic "asked about, not blocked" wording would be wrong here:
      // `git push` is not asked about either.
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("has no command denylist"),
      );
    });

    it("warns when an ask rule's executable ends up auto-approved", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "npm *": "allow", "npm publish": "ask" } } },
        logger,
      });

      expect(allowListOf(content)).toEqual(["npm"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("the generated allow_list auto-approves commands they cover"),
      );
    });

    it("skips a pattern whose executable dcode would never compare", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "git;rm *": "allow", ls: "allow" } } },
        logger,
      });

      // Writing it would put a rule in the user's global config that can never
      // fire, and the import direction already refuses to read one back.
      expect(allowListOf(content)).toEqual(["ls"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("were therefore skipped"));
    });

    it("reports a bare executable as widened, since dcode holds no arguments", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { rm: "allow" } } },
        logger,
      });

      // Canonically `rm` means `rm` with no arguments; in dcode it auto-approves
      // `rm -rf /` too, so the narrow spelling widens further than the loud one.
      expect(allowListOf(content)).toEqual(["rm"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("were widened"));
    });

    it("catches an ask that names arguments even when its executable is a glob", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "npm *": "allow", "npm* publish": "ask" } } },
        logger,
      });

      // The ask names arguments the allow beside it covers, so the reduction
      // hands the collision to the allow — the glob in the executable does not
      // make it the broader rule.
      expect(allowListOf(content)).toEqual(["npm"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("npm* publish run without a prompt"),
      );
    });

    it("leaves an open-argument glob ask alone however many allows it covers", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "git *": "allow", "npm *": "allow", "git*": "ask" } } },
        logger,
      });

      // `git*` is broader than the `git *` it collides with, so the allow is
      // its exception — and whether a second, unrelated allow sits beside it
      // cannot change that reading.
      expect(allowListOf(content)).toEqual(["git", "npm"]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("leaves a blanket ask alone, since the allow rules are its exceptions", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "*": "ask", "git *": "allow" } } },
        logger,
      });

      // dcode reproduces this pair exactly — `git` is auto-approved and every
      // other command prompts — so there is nothing to warn about. A deny is
      // different: it outranks an allow, and dcode cannot express that.
      expect(allowListOf(content)).toEqual(["git"]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("catches a deny whose executable is itself a glob", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "npm *": "allow", "npm*": "deny" } } },
        logger,
      });

      // `*` is only the widest spelling of a glob executable; `npm*` covers the
      // generated `npm` just as surely, so the same warning has to fire.
      expect(allowListOf(content)).toEqual(["npm"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("are not merely unenforced"),
      );
    });

    it("warns that a blanket deny is what the allow_list overrides", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "*": "deny", "git *": "allow" } } },
        logger,
      });

      // The widest deny an author can write is the one the reduction inverts:
      // `git` runs with no prompt at all, not merely "on approval".
      expect(allowListOf(content)).toEqual(["git"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("are not merely unenforced"),
      );
    });

    it("blames the sentinel, not the allow_list, when everything is auto-approved", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: { bash: { "*": "allow", "npm publish": "ask" } } },
        logger,
      });

      // `allow_list = ["all"]` holds no executable name, so the wording that
      // points at one would send the author looking for a rule that is not there.
      expect(allowListOf(content)).toEqual(["all"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('allow_list = ["all"] auto-approves every command'),
      );
    });

    it("names the other tool's rules when they are what blocked the sentinel", async () => {
      const logger = createMockLogger();

      await generate({
        config: { permission: { bash: { "*": "allow" }, read: { "./.env": "deny" } } },
        logger,
      });

      // No bash deny rule exists, so "your config denies commands" would describe
      // a rule the author never wrote.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("your config has deny rules for other tools"),
      );
    });

    it("refuses to write dcode's app-managed `recent`", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: {}, deepagents: { startup: { recent: "auto" } } },
        logger,
      });

      // With no explicit `mode`, dcode restores `recent` at launch, so a
      // repository could switch a machine into auto-approval through it.
      expect(smolToml.parse(content).startup).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("dcode manages that key itself"),
      );
    });

    it("says nothing about a startup key it could not write", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: {}, deepagents: { startup: { future_key: null } } },
        logger,
      });

      // TOML has no null, so smol-toml drops the key; naming it would describe
      // a setting the file does not hold.
      expect(smolToml.parse(content).startup).toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("names a startup key it cannot judge", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: {}, deepagents: { startup: { something_new: true } } },
        logger,
      });

      // The override is loose so upstream additions still reach the config,
      // but the file it lands in is the machine's global one.
      expect(tableOf(content, "startup")).toEqual({ something_new: true });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("something_new"));
    });

    it("says nothing about a boolean startup key already true by default", async () => {
      const logger = createMockLogger();

      await generate({
        config: { permission: {}, deepagents: { startup: { read_project_dotenv: true } } },
        logger,
      });

      // Upstream defaults it to true, so this grants nothing; warning here
      // would bury the case where the user had turned it off.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("warns that a startup override relaxes the machine's global config", async () => {
      const logger = createMockLogger();

      const content = await generate({
        config: { permission: {}, deepagents: { startup: { mode: "yolo" } } },
        logger,
      });

      expect(tableOf(content, "startup")).toEqual({ mode: "yolo" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('mode = "yolo"'));
    });

    it("names the value a startup override replaces", async () => {
      const logger = createMockLogger();
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        "[startup]\nread_project_dotenv = false\n",
      );

      await generate({
        config: { permission: {}, deepagents: { startup: { read_project_dotenv: true } } },
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("read_project_dotenv = true (was false)"),
      );
    });

    it("says nothing about a startup override that grants nothing", async () => {
      const logger = createMockLogger();

      await generate({
        config: { permission: {}, deepagents: { startup: { mode: "manual" } } },
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("leaves a `shell` that parsed as a datetime untouched", async () => {
      const logger = createMockLogger();
      await writeFileContent(join(testDir, ".deepagents", "config.toml"), "shell = 1979-05-27\n");

      const content = await generate({
        config: { permission: { bash: { ls: "allow" } } },
        logger,
      });

      // smol-toml returns a datetime as a `Date` subclass. That is a record but
      // not a table, and spreading it would drop the value the file holds.
      expect(smolToml.parse(content).shell).toBeInstanceOf(Date);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("is not a table"));
    });

    it("leaves a `shell` that is not a table untouched", async () => {
      const logger = createMockLogger();
      await writeFileContent(join(testDir, ".deepagents", "config.toml"), 'shell = "bash"\n');

      const content = await generate({
        config: { permission: { bash: { ls: "allow" } } },
        logger,
      });

      expect(smolToml.parse(content).shell).toBe("bash");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("is not a table"));
    });

    it("reports removing an allowlist the user had curated", async () => {
      const logger = createMockLogger();
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        '[shell]\nallow_list = ["recommended"]\n',
      );

      await generate({ config: { permission: {} }, logger });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("was removed"));
    });

    it("throws a descriptive error when the existing config.toml is malformed", async () => {
      await writeFileContent(join(testDir, ".deepagents", "config.toml"), "[shell\n");

      await expect(generate({ config: { permission: { bash: { ls: "allow" } } } })).rejects.toThrow(
        /Failed to parse existing deepagents config/,
      );
    });
  });

  describe("toRulesyncPermissions", () => {
    it("lifts allowlist entries back as bash allow rules", () => {
      expect(importFrom('[shell]\nallow_list = ["git", "ls"]\n')).toEqual({
        permission: { bash: { git: "allow", ls: "allow" } },
      });
    });

    it("reads the comma-separated string spelling too", () => {
      expect(importFrom('[shell]\nallow_list = "git, ls"\n')).toEqual({
        permission: { bash: { git: "allow", ls: "allow" } },
      });
    });

    it("lifts the `all` sentinel as the wildcard pattern", () => {
      expect(importFrom('[shell]\nallow_list = ["all"]\n')).toEqual({
        permission: { bash: { "*": "allow" } },
      });
    });

    it("imports nothing when `all` shares the list with command names", () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      // dcode raises on that combination and ignores the option, so the
      // commands beside it are not actually auto-approved.
      expect(importFrom('[shell]\nallow_list = ["all", "git"]\n')).toEqual({ permission: {} });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("mixes 'all' with command names"));
    });

    it("drops the `recommended` sentinel rather than expanding it", () => {
      expect(importFrom('[shell]\nallow_list = ["recommended", "git"]\n')).toEqual({
        permission: { bash: { git: "allow" } },
      });
    });

    it("lifts the startup approval knobs into the deepagents override", () => {
      expect(
        importFrom('[startup]\nmode = "yolo"\nyolo_switcher = false\nrecent = "auto"\n'),
      ).toEqual({
        permission: {},
        // `recent` is app-managed session state, so it stays out of a file
        // that gets committed.
        deepagents: { startup: { mode: "yolo", yolo_switcher: false } },
      });
    });

    it("round-trips an allowlist through generate and import", async () => {
      const content = await generate({
        config: { permission: { bash: { "git *": "allow", ls: "allow" } } },
      });

      expect(importFrom(content)).toEqual({
        permission: { bash: { git: "allow", ls: "allow" } },
      });
    });

    it("skips entries dcode itself could never match", () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const config = importFrom('[shell]\nallow_list = ["git status", "npm-*", "ls"]\n');

      // Neither entry auto-approves anything upstream, and importing them would
      // let the next generate widen `git status` to every `git` invocation.
      expect(config).toEqual({ permission: { bash: { ls: "allow" } } });
      // Dropping them silently would read as "dcode approves these", which is
      // the opposite of what upstream does with them.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("git status, npm-*"));
    });

    it("skips entries dcode splits or refuses before comparing", () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const config = importFrom('[shell]\nallow_list = ["git;rm", "$(id)", "ls"]\n');

      // dcode splits a command on `;`/`&&`/`|` and rejects command substitution
      // before it ever compares a name, so neither entry approves anything.
      expect(config).toEqual({ permission: { bash: { ls: "allow" } } });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("git;rm, $(id)"));
    });

    it("reads the sentinels case-insensitively, the way upstream lowercases them", () => {
      const config = importFrom('[shell]\nallow_list = ["ALL"]\n');

      expect(config).toEqual({ permission: { bash: { "*": "allow" } } });
    });

    it("imports nothing when the array holds a non-string entry", () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const config = importFrom('[shell]\nallow_list = ["git", 3]\n');

      // dcode requires every element to be a string and drops the whole option
      // otherwise, so `git` is not auto-approved there either.
      expect(config).toEqual({ permission: {} });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignores 'allow_list' entirely"));
    });

    it("imports nothing from an allow_list that is neither a string nor an array", () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const config = importFrom("[shell]\nallow_list = 3\n");

      expect(config).toEqual({ permission: {} });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignores 'allow_list' entirely"));
    });

    it("leaves behind a startup value dcode cannot read", () => {
      const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      // dcode falls back to its own default for these, and the canonical schema
      // is stricter than TOML — importing them would write a permissions file
      // the next generate could not parse.
      const config = importFrom('[startup]\nmode = "AUTO"\nyolo_switcher = "yes"\n');

      expect(config).toEqual({ permission: {} });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('mode = "AUTO", yolo_switcher = "yes"'),
      );
    });

    it("lifts the dotenv knob back into the override", () => {
      const config = importFrom("[startup]\nread_project_dotenv = true\n");

      expect(config).toEqual({
        permission: {},
        deepagents: { startup: { read_project_dotenv: true } },
      });
    });

    it("throws a descriptive error when the file is malformed", () => {
      expect(() => importFrom("[shell\n")).toThrow(/Failed to parse deepagents permissions/);
    });
  });

  describe("fromFile", () => {
    it("reads the global config file", async () => {
      await writeFileContent(
        join(testDir, ".deepagents", "config.toml"),
        '[shell]\nallow_list = ["git"]\n',
      );

      const permissions = await DeepagentsPermissions.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(allowListOf(permissions.getFileContent())).toEqual(["git"]);
    });
  });
});
