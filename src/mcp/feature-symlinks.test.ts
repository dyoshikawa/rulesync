import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { ConsoleLogger } from "../utils/logger.js";
import { checkTools } from "./checks.js";
import { commandTools } from "./commands.js";
import {
  assertNoSymlinkInFeaturePath,
  assertNoSymlinkInFeatureTree,
  isFeatureSymlinkRefusal,
} from "./feature-symlinks.js";
import { hooksTools } from "./hooks.js";
import { ignoreTools } from "./ignore.js";
import { mcpTools } from "./mcp.js";
import { permissionsTools } from "./permissions.js";
import { ruleTools } from "./rules.js";
import { skillTools } from "./skills.js";

const SENTINEL = `---
targets: ["*"]
description: outside
---
# Outside sentinel
`;

const SYMLINK_REFUSAL = /symbolic link/i;

describe.skipIf(process.platform === "win32")("MCP feature symlink containment", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let outsideFile: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    outsideFile = join(testDir, "outside", "secret.md");
    await writeFileContent(outsideFile, SENTINEL);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe.each([
    {
      feature: "rule",
      dir: ".rulesync/rules",
      list: async () => JSON.parse(await ruleTools.listRules.execute()).rules,
      get: async (relativePathFromCwd: string) =>
        await ruleTools.getRule.execute({ relativePathFromCwd }),
      put: async (relativePathFromCwd: string) =>
        await ruleTools.putRule.execute({
          relativePathFromCwd,
          frontmatter: { targets: ["*"] },
          body: "# Overwritten",
        }),
    },
    {
      feature: "command",
      dir: ".rulesync/commands",
      list: async () => JSON.parse(await commandTools.listCommands.execute()).commands,
      get: async (relativePathFromCwd: string) =>
        await commandTools.getCommand.execute({ relativePathFromCwd }),
      put: async (relativePathFromCwd: string) =>
        await commandTools.putCommand.execute({
          relativePathFromCwd,
          frontmatter: { targets: ["*"] },
          body: "# Overwritten",
        }),
    },
    {
      feature: "check",
      dir: ".rulesync/checks",
      list: async () => JSON.parse(await checkTools.listChecks.execute()).checks,
      get: async (relativePathFromCwd: string) =>
        await checkTools.getCheck.execute({ relativePathFromCwd }),
      put: async (relativePathFromCwd: string) =>
        await checkTools.putCheck.execute({
          relativePathFromCwd,
          frontmatter: { targets: ["*"] },
          body: "# Overwritten",
        }),
    },
  ])("$feature", ({ dir, list, get, put }) => {
    it("refuses to list, get or put through a leaf symbolic link", async () => {
      await ensureDir(join(testDir, dir));
      await symlink(outsideFile, join(testDir, dir, "link.md"), "file");
      const errorSpy = vi.spyOn(ConsoleLogger.prototype, "error");

      expect(await list()).toEqual([]);
      expect(errorSpy).not.toHaveBeenCalled();
      await expect(get(join(dir, "link.md"))).rejects.toThrow(SYMLINK_REFUSAL);
      await expect(put(join(dir, "link.md"))).rejects.toThrow(SYMLINK_REFUSAL);
      expect(await readFileContent(outsideFile)).toBe(SENTINEL);
    });

    it("refuses to put through a dangling symbolic link", async () => {
      const missingTarget = join(testDir, "outside", "created.md");
      await ensureDir(join(testDir, dir));
      await symlink(missingTarget, join(testDir, dir, "dangling.md"), "file");

      await expect(put(join(dir, "dangling.md"))).rejects.toThrow(SYMLINK_REFUSAL);
      expect(await fileExists(missingTarget)).toBe(false);
    });

    it("still follows a symlinked .rulesync directory", async () => {
      const dotfiles = join(testDir, "dotfiles");
      await ensureDir(dotfiles);
      await symlink(dotfiles, join(testDir, ".rulesync"), "dir");

      await put(join(dir, "linked.md"));
      const featureDir = dir.replace(/^\.rulesync/, dotfiles);
      expect(await readFileContent(join(featureDir, "linked.md"))).toContain("# Overwritten");
      expect(await list()).toHaveLength(1);
      expect(JSON.parse(await get(join(dir, "linked.md"))).body).toContain("# Overwritten");
    });
  });

  describe("rule", () => {
    it("still follows a feature directory that is itself a symbolic link", async () => {
      const sharedRules = join(testDir, "shared-rules");
      await ensureDir(sharedRules);
      await ensureDir(join(testDir, ".rulesync"));
      await symlink(sharedRules, join(testDir, ".rulesync", "rules"), "dir");

      await ruleTools.putRule.execute({
        relativePathFromCwd: ".rulesync/rules/linked.md",
        frontmatter: { targets: ["*"] },
        body: "# Linked",
      });

      expect(await readFileContent(join(sharedRules, "linked.md"))).toContain("# Linked");
      expect(JSON.parse(await ruleTools.listRules.execute()).rules).toHaveLength(1);
      expect(
        JSON.parse(
          await ruleTools.getRule.execute({ relativePathFromCwd: ".rulesync/rules/linked.md" }),
        ).body,
      ).toContain("# Linked");
    });
  });

  describe("ignore", () => {
    it("refuses to get or put a symlinked .rulesync/.aiignore", async () => {
      await ensureDir(join(testDir, ".rulesync"));
      await symlink(outsideFile, join(testDir, ".rulesync", ".aiignore"), "file");

      await expect(ignoreTools.getIgnoreFile.execute()).rejects.toThrow(SYMLINK_REFUSAL);
      await expect(ignoreTools.putIgnoreFile.execute({ content: "secret\n" })).rejects.toThrow(
        SYMLINK_REFUSAL,
      );
      expect(await readFileContent(outsideFile)).toBe(SENTINEL);
    });

    it("still follows a symlinked .rulesync directory", async () => {
      const dotfiles = join(testDir, "dotfiles");
      await ensureDir(dotfiles);
      await symlink(dotfiles, join(testDir, ".rulesync"), "dir");

      await ignoreTools.putIgnoreFile.execute({ content: "dist/\n" });
      expect(await readFileContent(join(dotfiles, ".aiignore"))).toBe("dist/\n");
      expect(JSON.parse(await ignoreTools.getIgnoreFile.execute()).content).toBe("dist/\n");
    });
  });

  describe.each([
    {
      feature: "mcp",
      fileName: "mcp.jsonc",
      legacyFileName: "mcp.json",
      get: async () => await mcpTools.getMcpFile.execute(),
      put: async () => await mcpTools.putMcpFile.execute({ content: '{ "mcpServers": {} }' }),
    },
    {
      feature: "hooks",
      fileName: "hooks.jsonc",
      legacyFileName: "hooks.json",
      get: async () => await hooksTools.getHooksFile.execute(),
      put: async () => await hooksTools.putHooksFile.execute({ content: '{ "hooks": {} }' }),
    },
    {
      feature: "permissions",
      fileName: "permissions.jsonc",
      legacyFileName: "permissions.json",
      get: async () => await permissionsTools.getPermissionsFile.execute(),
      put: async () =>
        await permissionsTools.putPermissionsFile.execute({ content: '{ "permission": {} }' }),
    },
  ])("$feature", ({ fileName, legacyFileName, get, put }) => {
    it("refuses to get or put a symlinked source file", async () => {
      await ensureDir(join(testDir, ".rulesync"));
      await symlink(outsideFile, join(testDir, ".rulesync", fileName), "file");

      await expect(get()).rejects.toThrow(SYMLINK_REFUSAL);
      await expect(put()).rejects.toThrow(SYMLINK_REFUSAL);
      expect(await readFileContent(outsideFile)).toBe(SENTINEL);
    });

    it("refuses to get a symlinked legacy source file", async () => {
      await ensureDir(join(testDir, ".rulesync"));
      await symlink(outsideFile, join(testDir, ".rulesync", legacyFileName), "file");

      await expect(get()).rejects.toThrow(SYMLINK_REFUSAL);
    });
  });

  describe("skill", () => {
    const skillsDir = ".rulesync/skills";
    const skillBody = `---
name: shared
description: shared skill
---
# Shared
`;

    it("refuses to list or get a skill holding a symbolic link", async () => {
      await writeFileContent(join(testDir, skillsDir, "leaky", "SKILL.md"), skillBody);
      await symlink(outsideFile, join(testDir, skillsDir, "leaky", "notes.md"), "file");
      const errorSpy = vi.spyOn(ConsoleLogger.prototype, "error");

      expect(JSON.parse(await skillTools.listSkills.execute()).skills).toEqual([]);
      expect(errorSpy).not.toHaveBeenCalled();
      await expect(
        skillTools.getSkill.execute({ relativeDirPathFromCwd: join(skillsDir, "leaky") }),
      ).rejects.toThrow(SYMLINK_REFUSAL);
    });

    it("refuses to get a skill directory that is a symbolic link", async () => {
      const outsideSkill = join(testDir, "outside", "skill");
      await writeFileContent(join(outsideSkill, "SKILL.md"), skillBody);
      await ensureDir(join(testDir, skillsDir));
      await symlink(outsideSkill, join(testDir, skillsDir, "linked"), "dir");

      await expect(
        skillTools.getSkill.execute({ relativeDirPathFromCwd: join(skillsDir, "linked") }),
      ).rejects.toThrow(SYMLINK_REFUSAL);
    });

    it("refuses to put through a symlinked skill directory, SKILL.md or other file", async () => {
      const outsideDir = join(testDir, "outside", "tool-config");
      await ensureDir(outsideDir);
      await ensureDir(join(testDir, skillsDir, "planted", "refs"));
      await symlink(outsideDir, join(testDir, skillsDir, "dir-link"), "dir");
      await symlink(outsideFile, join(testDir, skillsDir, "planted", "SKILL.md"), "file");
      await ensureDir(join(testDir, skillsDir, "other"));
      await symlink(outsideDir, join(testDir, skillsDir, "other", "refs"), "dir");
      const put = async (dirName: string) =>
        await skillTools.putSkill.execute({
          relativeDirPathFromCwd: join(skillsDir, dirName),
          frontmatter: { name: dirName, description: "x", targets: ["*"] },
          body: "# Overwritten",
          otherFiles: [{ name: "refs/nested/file.md", body: "overwritten" }],
        });

      await expect(put("dir-link")).rejects.toThrow(SYMLINK_REFUSAL);
      await expect(put("planted")).rejects.toThrow(SYMLINK_REFUSAL);
      await expect(put("other")).rejects.toThrow(SYMLINK_REFUSAL);
      expect(await readFileContent(outsideFile)).toBe(SENTINEL);
      expect(await fileExists(join(outsideDir, "SKILL.md"))).toBe(false);
      expect(await fileExists(join(outsideDir, "nested"))).toBe(false);
    });

    it("writes nothing when a later other file would be written through a link", async () => {
      const outsideDir = join(testDir, "outside", "tool-config");
      const skillDir = join(testDir, skillsDir, "partial");
      await ensureDir(outsideDir);
      await ensureDir(skillDir);
      await symlink(outsideDir, join(skillDir, "refs"), "dir");

      await expect(
        skillTools.putSkill.execute({
          relativeDirPathFromCwd: join(skillsDir, "partial"),
          frontmatter: { name: "partial", description: "x", targets: ["*"] },
          body: "# Partial",
          otherFiles: [
            { name: "first.md", body: "first" },
            { name: "refs/second.md", body: "second" },
          ],
        }),
      ).rejects.toThrow(SYMLINK_REFUSAL);

      expect(await fileExists(join(skillDir, "SKILL.md"))).toBe(false);
      expect(await fileExists(join(skillDir, "first.md"))).toBe(false);
      expect(await fileExists(join(outsideDir, "second.md"))).toBe(false);
    });

    it("still follows a symlinked .rulesync directory", async () => {
      const dotfiles = join(testDir, "dotfiles");
      await ensureDir(dotfiles);
      await symlink(dotfiles, join(testDir, ".rulesync"), "dir");

      await skillTools.putSkill.execute({
        relativeDirPathFromCwd: join(skillsDir, "shared"),
        frontmatter: { name: "shared", description: "shared skill", targets: ["*"] },
        body: "# Shared",
        otherFiles: [{ name: "refs/notes.md", body: "notes" }],
      });

      expect(await readFileContent(join(dotfiles, "skills", "shared", "refs", "notes.md"))).toBe(
        "notes",
      );
      expect(JSON.parse(await skillTools.listSkills.execute()).skills).toHaveLength(1);
      expect(
        JSON.parse(
          await skillTools.getSkill.execute({ relativeDirPathFromCwd: join(skillsDir, "shared") }),
        ).otherFiles,
      ).toEqual([{ name: "refs/notes.md", body: "notes", encoding: "utf-8" }]);
    });
  });

  describe("helpers", () => {
    it("accepts a plain path and a feature directory that is itself a link", async () => {
      const realDir = join(testDir, "real-rules");
      await writeFileContent(join(realDir, "a.md"), "a");
      await symlink(realDir, join(testDir, "linked-rules"), "dir");

      await expect(
        assertNoSymlinkInFeaturePath({
          featureDirPath: join(testDir, "linked-rules"),
          targetPath: join(testDir, "linked-rules", "a.md"),
        }),
      ).resolves.toBeUndefined();
      await expect(
        assertNoSymlinkInFeatureTree({
          featureDirPath: testDir,
          dirPath: realDir,
        }),
      ).resolves.toBeUndefined();
    });

    it("tells a refusal from a filesystem error", async () => {
      await ensureDir(join(testDir, "skills", "x", "deep"));
      await symlink(outsideFile, join(testDir, "skills", "x", "deep", "link.md"), "file");

      const refusal = await assertNoSymlinkInFeatureTree({
        featureDirPath: join(testDir, "skills"),
        dirPath: join(testDir, "skills", "x"),
      }).catch((error: unknown) => error);
      expect(isFeatureSymlinkRefusal(refusal)).toBe(true);

      const missing = await assertNoSymlinkInFeatureTree({
        featureDirPath: join(testDir, "skills"),
        dirPath: join(testDir, "skills", "missing"),
      }).catch((error: unknown) => error);
      expect(isFeatureSymlinkRefusal(missing)).toBe(false);
    });
  });
});
