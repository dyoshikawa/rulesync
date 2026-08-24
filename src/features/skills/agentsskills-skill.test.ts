import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { MAX_REPORTED_PATHS } from "../../types/ai-dir.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AgentsSkillsSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .agents/skills as relativeDirPath", () => {
      const paths = AgentsSkillsSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should return the same .agents/skills path in global mode (resolved under home)", () => {
      // The Agent Skills standard defines `~/.agents/skills/` as the personal location.
      const paths = AgentsSkillsSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should carry standard optional frontmatter through the agentsskills section", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        dirName: "std-skill",
        frontmatter: {
          name: "std-skill",
          description: "Standard",
          license: "MIT",
          compatibility: { "agent-skills": ">=1.0.0" },
          metadata: { version: "1.2.3" },
          "allowed-tools": "shell",
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().agentsskills).toEqual({
        license: "MIT",
        compatibility: { "agent-skills": ">=1.0.0" },
        metadata: { version: "1.2.3" },
        // Normalized back to the canonical rulesync array on import.
        "allowed-tools": ["shell"],
      });

      const roundTripped = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });
      const fm = roundTripped.getFrontmatter();
      expect(fm.license).toBe("MIT");
      expect(fm["allowed-tools"]).toBe("shell");
      expect(fm.metadata).toEqual({ version: "1.2.3" });
    });

    it("should carry a string compatibility value through the agentsskills section", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        dirName: "string-compat-skill",
        frontmatter: {
          name: "string-compat-skill",
          description: "Standard",
          compatibility: "Requires Python 3.14+ and uv",
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().agentsskills).toEqual({
        compatibility: "Requires Python 3.14+ and uv",
      });

      const roundTripped = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter().compatibility).toBe("Requires Python 3.14+ and uv");
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the agent skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(AgentsSkillsSkill);
      expect(skill.getBody()).toBe("This is the body of the agent skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the agent skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(AgentsSkillsSkill);
      expect(skill.getBody()).toBe("This is the body of the agent skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should import a SKILL.md with a string compatibility value (Agent Skills spec form)", async () => {
      const skillDir = join(testDir, ".agents", "skills", "string-compat-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: string-compat-skill
description: Spec-compliant skill
compatibility: Requires Python 3.14+ and uv
---

Body.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "string-compat-skill",
      });

      expect(skill.getFrontmatter().compatibility).toBe("Requires Python 3.14+ and uv");
    });

    it("should carry hidden companion files, minus the entries that are never skill content", async () => {
      // The spec says a skill directory "may contain any files and directories
      // beyond the required SKILL.md", so a dot-prefixed companion is content.
      // `.git` and `.DS_Store` are the exceptions: a nested repository is not
      // reproduced, and the Finder's index is noise.
      const skillDir = join(testDir, ".agents", "skills", "hidden-files-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        [
          "---",
          "name: hidden-files-skill",
          "description: Carries hidden files",
          "---",
          "",
          "Body.",
        ].join("\n"),
      );
      await writeFileContent(join(skillDir, ".env.example"), "TOKEN=\n");
      await writeFileContent(join(skillDir, ".config", "a.json"), "{}\n");
      await writeFileContent(join(skillDir, "scripts", "run.sh"), "#!/bin/sh\n");
      await writeFileContent(join(skillDir, ".DS_Store"), "finder noise\n");
      await writeFileContent(join(skillDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "hidden-files-skill",
      });

      const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
      expect(carriedPaths).toContain(".env.example");
      expect(carriedPaths).toContain(join(".config", "a.json"));
      expect(carriedPaths).toContain(join("scripts", "run.sh"));
      expect(carriedPaths).not.toContain(".DS_Store");
      expect(carriedPaths).not.toContain(join(".git", "HEAD"));
    });

    it("should not carry credential-shaped hidden entries", async () => {
      // Carrying hidden files copies them into every enabled tool root, so a
      // secret dropped into a skill directory would be multiplied across the
      // repository. None of these names is ever skill content.
      const skillDir = join(testDir, ".agents", "skills", "secrets-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        ["---", "name: secrets-skill", "description: Holds secrets", "---", "", "Body."].join("\n"),
      );
      await writeFileContent(join(skillDir, ".env"), "TOKEN=real\n");
      await writeFileContent(join(skillDir, ".env.local"), "TOKEN=real\n");
      await writeFileContent(join(skillDir, ".env.example"), "TOKEN=\n");
      await writeFileContent(join(skillDir, ".npmrc"), "//registry:_authToken=real\n");
      await writeFileContent(join(skillDir, ".env.production"), "TOKEN=real\n");
      await writeFileContent(join(skillDir, ".envrc"), "export TOKEN=real\n");
      await writeFileContent(join(skillDir, ".pgpass"), "host:5432:db:user:real\n");
      await writeFileContent(join(skillDir, ".ssh", "id_rsa"), "key\n");
      await writeFileContent(join(skillDir, ".aws", "credentials"), "aws-secret\n");
      await writeFileContent(join(skillDir, ".docker", "config.json"), "{}\n");
      await writeFileContent(join(skillDir, ".config", "gh", "hosts.yml"), "oauth_token: real\n");
      // Deliberately upper-cased: macOS and Windows resolve `.GNUPG` and `.gnupg`
      // to the same directory, so a case-sensitive exclusion is a hole there.
      await writeFileContent(join(skillDir, ".GNUPG", "secring.gpg"), "key\n");
      // Windows drops the trailing space when the file lands, turning this one
      // back into a plain `.env`, so it is judged as the name it becomes.
      await writeFileContent(join(skillDir, ".env "), "TOKEN=real\n");
      // Windows drops a trailing dot the same way, so `.env.` is `.env` too.
      await writeFileContent(join(skillDir, ".env."), "TOKEN=real\n");
      // A compound template name is a template: the last piece decides.
      await writeFileContent(join(skillDir, ".env.local.example"), "TOKEN=\n");
      // direnv keeps real values in `.envrc.local` as routinely as a project
      // keeps them in `.env.local`.
      await writeFileContent(join(skillDir, ".envrc.local"), "export TOKEN=real\n");
      await writeFileContent(join(skillDir, ".envrc.example"), "export TOKEN=\n");
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      try {
        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "secrets-skill",
        });

        const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
        expect(carriedPaths).toEqual([".env.example", ".env.local.example", ".envrc.example"]);
        // Leaving a credential out protects something, so it is reported rather
        // than done in silence.
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("named as a credential store"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should not report the exclusions that are only noise", async () => {
      // A `.DS_Store` or a build tree is what every user expects to be left
      // out, and warning about it on every generate would be noise itself.
      const skillDir = join(testDir, ".agents", "skills", "quiet-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        ["---", "name: quiet-skill", "description: Ships scripts", "---", "", "Body."].join("\n"),
      );
      await writeFileContent(join(skillDir, ".DS_Store"), "index\n");
      await writeFileContent(join(skillDir, ".turbo", "cache.json"), "{}\n");
      await writeFileContent(join(skillDir, ".hg", "store", "data.i"), "history\n");
      await writeFileContent(join(skillDir, ".svn", "wc.db"), "history\n");
      await writeFileContent(join(skillDir, ".cache", "build.json"), "{}\n");
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      try {
        await AgentsSkillsSkill.fromDir({ outputRoot: testDir, dirName: "quiet-skill" });

        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should not carry build and cache directories", async () => {
      // A skill that ships Python scripts routinely has a `.venv` beside them.
      // Copying it into every enabled tool root would multiply thousands of
      // files that are not skill content by the number of targets.
      const skillDir = join(testDir, ".agents", "skills", "venv-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        ["---", "name: venv-skill", "description: Ships scripts", "---", "", "Body."].join("\n"),
      );
      await writeFileContent(join(skillDir, "scripts", "run.py"), "print('hi')\n");
      await writeFileContent(join(skillDir, ".venv", "lib", "site.py"), "# venv\n");
      await writeFileContent(join(skillDir, ".mypy_cache", "cache.json"), "{}\n");
      await writeFileContent(join(skillDir, ".ruff_cache", "cache.json"), "{}\n");

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "venv-skill",
      });

      const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
      expect(carriedPaths).toEqual([join("scripts", "run.py")]);
    });

    it("should carry a directory whose name starts with two dots", async () => {
      // `path.relative` reports `..cache/note.md` for a directory that really
      // is inside the skill, which a prefix test would read as an escape.
      const skillDir = join(testDir, ".agents", "skills", "double-dot-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        ["---", "name: double-dot-skill", "description: Odd directory", "---", "", "Body."].join(
          "\n",
        ),
      );
      await writeFileContent(join(skillDir, "..cache", "note.md"), "note\n");

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "double-dot-skill",
      });

      const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
      expect(carriedPaths).toEqual([join("..cache", "note.md")]);
    });

    // fs.symlink with the default/file type needs admin or Developer Mode on Windows.
    it.skipIf(process.platform === "win32")(
      "should not carry hidden entries a symbolic link reaches outside the skill directory",
      async () => {
        // Following a link out of the tree is deliberate for named files, but a
        // single link to a home directory would otherwise pull in every dotfile
        // under it.
        const outsideDir = join(testDir, "outside");
        await writeFileContent(join(outsideDir, ".secret-config"), "secret\n");
        await writeFileContent(join(outsideDir, "shared.md"), "shared\n");

        const skillDir = join(testDir, ".agents", "skills", "linked-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: linked-skill", "description: Links out", "---", "", "Body."].join("\n"),
        );
        await symlink(outsideDir, join(skillDir, "docs"));

        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "linked-skill",
        });

        const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
        // The named file keeps its documented behavior; the dotfile does not.
        expect(carriedPaths).toContain(join("docs", "shared.md"));
        expect(carriedPaths).not.toContain(join("docs", ".secret-config"));
      },
    );

    it.skipIf(process.platform === "win32")(
      "should warn about the hidden entries a symbolic link reached outside the skill directory",
      async () => {
        const outsideDir = join(testDir, "outside");
        await writeFileContent(join(outsideDir, ".secret-config"), "secret\n");

        const skillDir = join(testDir, ".agents", "skills", "warned-link-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: warned-link-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink(outsideDir, join(skillDir, "docs"));
        const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

        try {
          await AgentsSkillsSkill.fromDir({ outputRoot: testDir, dirName: "warned-link-skill" });

          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Not carrying 1 hidden entry that resolves outside"),
          );
        } finally {
          warnSpy.mockRestore();
        }
      },
    );

    it.skipIf(process.platform === "win32")(
      "should count the escaped hidden entries a warning does not name",
      async () => {
        const outsideDir = join(testDir, "outside");
        for (let index = 0; index < MAX_REPORTED_PATHS + 2; index++) {
          await writeFileContent(join(outsideDir, `.file-${index}`), "secret\n");
        }

        const skillDir = join(testDir, ".agents", "skills", "many-links-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: many-links-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink(outsideDir, join(skillDir, "docs"));
        const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

        try {
          await AgentsSkillsSkill.fromDir({ outputRoot: testDir, dirName: "many-links-skill" });

          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining(`Not carrying ${MAX_REPORTED_PATHS + 2} hidden entries`),
          );
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(", and 2 more"));
        } finally {
          warnSpy.mockRestore();
        }
      },
    );

    it.skipIf(process.platform === "win32")(
      "should not carry a credential directory that a symbolic link renames",
      async () => {
        // Renaming the link is all it would take to slip past a rule that only
        // looked at the path inside the skill directory.
        const outsideDir = join(testDir, "outside");
        await writeFileContent(join(outsideDir, ".aws", "credentials"), "aws-secret\n");

        const skillDir = join(testDir, ".agents", "skills", "renamed-link-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: renamed-link-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink(join(outsideDir, ".aws"), join(skillDir, "vendor"));

        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "renamed-link-skill",
        });

        expect(skill.getOtherFiles()).toEqual([]);
      },
    );

    it.skipIf(process.platform === "win32")(
      "should strip control characters from the paths it reports",
      async () => {
        // The tree may have been cloned from anywhere, and these warnings name
        // paths whose names the author of that tree chose.
        const skillDir = join(testDir, ".agents", "skills", "control-char-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: control-char-skill", "description: Odd names", "---", "", "Body."].join(
            "\n",
          ),
        );
        await writeFileContent(join(skillDir, ".env.production\u001b[2K"), "TOKEN=real\n");
        const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

        try {
          await AgentsSkillsSkill.fromDir({ outputRoot: testDir, dirName: "control-char-skill" });

          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(".env.production[2K"));
          expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("\u001b"));
        } finally {
          warnSpy.mockRestore();
        }
      },
    );

    it.skipIf(process.platform === "win32")(
      "should carry a named file whose symbolic link target sits under a hidden directory",
      async () => {
        // A shared skill tree usually lives in a dotfiles repository, so the
        // resolved path is full of hidden ancestors. What decides is the name
        // inside the skill directory — somebody chose `docs/guide.md`.
        const sharedDir = join(testDir, ".dotfiles", "shared");
        await writeFileContent(join(sharedDir, "guide.md"), "guide\n");

        const skillDir = join(testDir, ".agents", "skills", "dotfiles-link-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: dotfiles-link-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink(sharedDir, join(skillDir, "docs"));

        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "dotfiles-link-skill",
        });

        const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
        expect(carriedPaths).toEqual([join("docs", "guide.md")]);
      },
    );

    it.skipIf(process.platform === "win32")(
      "should stay bounded when two symbolic links point back at an ancestor",
      async () => {
        // Two links per directory double the paths globby walks per level, and
        // it follows them to the kernel's ELOOP limit, so an unbounded walk of
        // a cloned tree exhausts the heap before anything filters the result.
        const skillDir = join(testDir, ".agents", "skills", "cycle-skill");
        const nestedDir = join(skillDir, "sub");
        await ensureDir(nestedDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: cycle-skill", "description: Loops", "---", "", "Body."].join("\n"),
        );
        await writeFileContent(join(nestedDir, "note.md"), "note\n");
        await symlink(skillDir, join(nestedDir, "up"));
        await symlink(skillDir, join(nestedDir, ".up-hidden"));

        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "cycle-skill",
        });

        // Every path reaches the one real file, so deduplication leaves it once.
        const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
        expect(carriedPaths).toEqual([join("sub", "note.md")]);
      },
      30_000,
    );

    it.skipIf(process.platform === "win32")(
      "should carry a named file that links directly into a hidden directory",
      async () => {
        // The link is a file rather than a directory this time: the same rule
        // decides it, on the name the skill directory gives it.
        const sharedDir = join(testDir, ".dotfiles", "shared");
        await writeFileContent(join(sharedDir, "guide.md"), "guide\n");

        const skillDir = join(testDir, ".agents", "skills", "dotfiles-file-link-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          [
            "---",
            "name: dotfiles-file-link-skill",
            "description: Links out",
            "---",
            "",
            "Body.",
          ].join("\n"),
        );
        await symlink(join(sharedDir, "guide.md"), join(skillDir, "guide.md"));

        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "dotfiles-file-link-skill",
        });

        const carriedPaths = skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath);
        expect(carriedPaths).toEqual(["guide.md"]);
      },
    );

    it.skipIf(process.platform === "win32")(
      "should report the entries a symbolic link carries in from outside",
      async () => {
        // Carried or not, content from outside the tree is about to be copied
        // into every enabled tool root, which is worth saying out loud.
        const outsideDir = join(testDir, "outside");
        await writeFileContent(join(outsideDir, "shared.md"), "shared\n");

        const skillDir = join(testDir, ".agents", "skills", "outside-link-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: outside-link-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink(outsideDir, join(skillDir, "docs"));
        const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

        try {
          await AgentsSkillsSkill.fromDir({ outputRoot: testDir, dirName: "outside-link-skill" });

          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Carrying 1 entry that resolves outside"),
          );
        } finally {
          warnSpy.mockRestore();
        }
      },
    );

    it.skipIf(process.platform === "win32")(
      "should not carry a named symbolic link that resolves to a hidden file",
      async () => {
        // The name inside the skill directory decides for the ancestors of the
        // target, not for the target itself: `~/.claude/.credentials.json` is a
        // file nobody named for a skill, whatever the link is called.
        const outsideDir = join(testDir, "outside");
        await writeFileContent(join(outsideDir, ".credentials.json"), '{"token":"real"}\n');

        const skillDir = join(testDir, ".agents", "skills", "renamed-dotfile-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: renamed-dotfile-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink(join(outsideDir, ".credentials.json"), join(skillDir, "notes.json"));

        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "renamed-dotfile-skill",
        });

        expect(skill.getOtherFiles()).toEqual([]);
      },
    );

    it.skipIf(process.platform !== "linux")(
      "should not carry a symbolic link that resolves into a system pseudo-filesystem",
      async () => {
        // `/proc/self/environ` stats as an ordinary file and reads back every
        // environment variable of the running process, API keys included.
        const skillDir = join(testDir, ".agents", "skills", "procfs-link-skill");
        await ensureDir(skillDir);
        await writeFileContent(
          join(skillDir, SKILL_FILE_NAME),
          ["---", "name: procfs-link-skill", "description: Links out", "---", "", "Body."].join(
            "\n",
          ),
        );
        await symlink("/proc/self/environ", join(skillDir, "env.txt"));
        const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

        try {
          const skill = await AgentsSkillsSkill.fromDir({
            outputRoot: testDir,
            dirName: "procfs-link-skill",
          });

          expect(skill.getOtherFiles()).toEqual([]);
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("system pseudo-filesystem"));
        } finally {
          warnSpy.mockRestore();
        }
      },
    );

    it("should warn about an empty description instead of dropping the skill", async () => {
      // A conformant client skips such a skill, so the user has to be told.
      // Rulesync converts rather than loads, so it imports it all the same.
      const skillDir = join(testDir, ".agents", "skills", "empty-description-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        ["---", "name: empty-description-skill", 'description: ""', "---", "", "Body."].join("\n"),
      );
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      try {
        const skill = await AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-description-skill",
        });

        expect(skill.getBody()).toBe("Body.");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("`description` is required and must not be empty"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should warn that a nested repository is not carried with the skill", async () => {
      const skillDir = join(testDir, ".agents", "skills", "nested-repo-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        [
          "---",
          "name: nested-repo-skill",
          "description: Has a nested repo",
          "---",
          "",
          "Body.",
        ].join("\n"),
      );
      await writeFileContent(join(skillDir, ".git", "HEAD"), "ref: refs/heads/main\n");
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      try {
        await AgentsSkillsSkill.fromDir({ outputRoot: testDir, dirName: "nested-repo-skill" });

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("a nested repository is excluded"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should recover a SKILL.md whose description contains an unquoted colon", async () => {
      // Authored for a client with a lenient parser. Without the retry the
      // lenient skill import skips the whole directory.
      const skillDir = join(testDir, ".agents", "skills", "colon-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        [
          "---",
          "name: colon-skill",
          "description: Use this skill when: the user asks about PDFs",
          "---",
          "",
          "Body.",
        ].join("\n"),
      );

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "colon-skill",
      });

      expect(skill.getFrontmatter().description).toBe(
        "Use this skill when: the user asks about PDFs",
      );
      expect(skill.getBody()).toBe("Body.");
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const agentsSkillsSkill = AgentsSkillsSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(agentsSkillsSkill).toBeInstanceOf(AgentsSkillsSkill);
      expect(agentsSkillsSkill.getBody()).toBe("Test body content");
      expect(agentsSkillsSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should serialize allowed-tools, compatibility and metadata into the spec's scalar forms", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill for conformance check.",
          agentsskills: {
            "allowed-tools": ["Read", "Bash(git:*)"],
            compatibility: { runtime: "node", packages: ["jq"] },
            metadata: { version: 1, author: "example-org", tags: ["a", "b"] },
          },
        },
        body: "Body",
        validate: true,
      });

      const agentsSkillsSkill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(agentsSkillsSkill.getFrontmatter()).toEqual({
        name: "demo-skill",
        description: "Demo skill for conformance check.",
        "allowed-tools": "Read Bash(git:*)",
        compatibility: 'runtime: node, packages: ["jq"]',
        metadata: { version: "1", author: "example-org", tags: '["a","b"]' },
      });
    });

    it("should leave already-conformant scalar values untouched", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: {
            "allowed-tools": "Bash(git:*) Read",
            compatibility: "Requires Python 3.14+ and uv",
            metadata: { version: "1.0" },
          },
        },
        body: "Body",
        validate: true,
      });

      expect(AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "demo-skill",
        description: "Demo skill.",
        "allowed-tools": "Bash(git:*) Read",
        compatibility: "Requires Python 3.14+ and uv",
        metadata: { version: "1.0" },
      });
    });

    it("should warn about every normative name/description violation without failing", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "My_Bad--Name",
        frontmatter: {
          name: "Totally-Different-NAME--x",
          description: "",
        },
        body: "Body",
        validate: true,
      });

      const agentsSkillsSkill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      // Generation still succeeds — import stays lenient per the spec's client guide.
      expect(agentsSkillsSkill).toBeInstanceOf(AgentsSkillsSkill);

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(3);
      expect(warnings.some((w) => w.includes("lowercase letters, digits and single hyphens"))).toBe(
        true,
      );
      expect(
        warnings.some((w) => w.includes('must match its parent directory name "My_Bad--Name"')),
      ).toBe(true);
      expect(
        warnings.some((w) => w.includes("`description` is required and must not be empty")),
      ).toBe(true);
      for (const warning of warnings) {
        // The reported path is rooted at outputRoot so a global-scope skill
        // points at the file that actually gets written.
        expect(warning).toContain(
          join(testDir, ".agents", "skills", "My_Bad--Name", SKILL_FILE_NAME),
        );
      }
    });

    it("should warn when name, description or compatibility exceed their length limits", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "a".repeat(65),
        frontmatter: {
          name: "a".repeat(65),
          description: "d".repeat(1025),
          agentsskills: { compatibility: "c".repeat(501) },
        },
        body: "Body",
        validate: true,
      });

      AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings.some((w) => w.includes("`name` is 65 characters"))).toBe(true);
      expect(warnings.some((w) => w.includes("`description` is 1025 characters"))).toBe(true);
      expect(warnings.some((w) => w.includes("`compatibility` is 501 characters"))).toBe(true);
    });

    it("should encode a self-referential metadata value instead of throwing", () => {
      // YAML anchors let a hand-written SKILL.md produce a genuinely circular
      // object, which a plain JSON.stringify would reject.
      const circular: Record<string, unknown> = { label: "root" };
      circular.self = circular;

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { metadata: { graph: circular } },
        },
        body: "Body",
        validate: true,
      });

      const metadata = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()
        .metadata as Record<string, string>;
      expect(metadata.graph).toBe('{"label":"root","self":"[repeated reference]"}');
    });

    it("should encode each shared metadata node once so aliases cannot blow up the output", () => {
      // Without this, N levels of YAML aliases expand exponentially: a few
      // hundred bytes of input becomes tens of megabytes of JSON.
      const leaf = { value: "x" };
      const shared = { a: leaf, b: leaf, c: leaf };

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { metadata: { shared } },
        },
        body: "Body",
        validate: true,
      });

      const metadata = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()
        .metadata as Record<string, string>;
      expect(metadata.shared).toBe(
        '{"a":{"value":"x"},"b":"[repeated reference]","c":"[repeated reference]"}',
      );
    });

    it("should warn when an allowed-tools entry contains whitespace", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { "allowed-tools": ["Read", "Bash(git status)"] },
        },
        body: "Body",
        validate: true,
      });

      const skill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("Read Bash(git status)");
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"Bash(git status)" contains whitespace');
    });

    it("should render a YAML timestamp as its ISO form rather than a quoted JSON string", () => {
      // js-yaml resolves `released: 2024-01-01` into a Date; JSON-encoding it
      // would fold its own quotes into the emitted scalar.
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: {
            metadata: { released: new Date("2024-01-01T00:00:00.000Z"), stable: true },
          },
        },
        body: "Body",
        validate: true,
      });

      expect(
        AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter().metadata,
      ).toEqual({ released: "2024-01-01T00:00:00.000Z", stable: "true" });
    });

    it("should drop values that normalize to the empty string instead of emitting them", () => {
      // The spec requires `compatibility` to be 1-500 characters when present,
      // and an empty `allowed-tools` says nothing.
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { compatibility: {}, "allowed-tools": [] },
        },
        body: "Body",
        validate: true,
      });

      expect(AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "demo-skill",
        description: "Demo skill.",
      });
    });

    it("should warn when an object compatibility exceeds 500 characters only after flattening", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { compatibility: { runtime: "n".repeat(500) } },
        },
        body: "Body",
        validate: true,
      });

      AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings.some((w) => w.includes("`compatibility` is 509 characters"))).toBe(true);
    });

    it("should not warn for a fully conformant skill", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract PDF text. Use when handling PDFs.",
        },
        body: "Body",
        validate: true,
      });

      AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "all-targets-skill",
        frontmatter: {
          name: "All Targets Skill",
          description: "Skill for all targets",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AgentsSkillsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'agentsskills'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "agentsskills-skill",
        frontmatter: {
          name: "AgentsSkills Skill",
          description: "Skill for agentsskills",
          targets: ["copilot", "agentsskills"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AgentsSkillsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'agentsskills'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "claudecode-only-skill",
        frontmatter: {
          name: "ClaudeCode Only Skill",
          description: "Skill for claudecode only",
          targets: ["claudecode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AgentsSkillsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = AgentsSkillsSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default outputRoot", () => {
      const skill = AgentsSkillsSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill).toBeInstanceOf(AgentsSkillsSkill);
      expect(skill.getOutputRoot()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = AgentsSkillsSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });
  });
});
