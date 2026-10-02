import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const exec = promisify(execFile);
const repo = process.env.RULESYNC_GH_TEST_REPO;

// RULESYNC_GH_TEST_REPO=owner/disposable-repo npx vitest run src/cli/commands/install-gh.integration.test.ts
// Use a repository with no other skills or releases: this test writes two commits.
// Uses real gh, real GitHub, and the full Rulesync CLI, with isolated homes.
it.skipIf(!repo)(
  "installs, migrates, and updates through real gh after the source advances",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rulesync-gh-"));
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project);
    await mkdir(home);
    const token =
      process.env.GH_TOKEN ??
      process.env.GITHUB_TOKEN ??
      (await exec("gh", ["auth", "token"])).stdout.trim();
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOME_DIR: home,
      GH_TOKEN: token,
      GH_PROMPT_DISABLED: "1",
      NODE_ENV: "e2e",
    };
    const gh = async (args: string[]) => {
      const result = await exec("gh", args, { cwd: project, env });
      return result.stdout + result.stderr;
    };
    const cli = [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("src/cli/index.ts"),
      "install",
      "--mode",
      "gh",
    ];
    const install = (flags: string[] = []) =>
      exec(process.execPath, [...cli, ...flags], { cwd: project, env });
    const endpoint = `repos/${repo}/contents/skills/rulesync-interop/SKILL.md`;
    const body = (version: string) =>
      `---\nname: rulesync-interop\ndescription: Interoperability fixture\n---\n${version}\n`;
    const publish = async (version: string, sha?: string) => {
      const result = await gh([
        "api",
        "--method",
        "PUT",
        endpoint,
        "-f",
        `message=Test fixture ${version}`,
        "-f",
        `content=${Buffer.from(body(version)).toString("base64")}`,
        ...(sha ? ["-f", `sha=${sha}`] : []),
      ]);
      return JSON.parse(result).content.sha as string;
    };
    try {
      let previousSha: string | undefined;
      try {
        previousSha = JSON.parse(await gh(["api", endpoint])).sha;
      } catch {
        /* empty fixture repo */
      }
      const firstSha = await publish("version-one", previousSha);
      const branch = JSON.parse(await gh(["api", `repos/${repo}`])).default_branch as string;
      const legacyDir = join(project, ".claude", "skills", "rulesync-interop");
      await mkdir(legacyDir, { recursive: true });
      const extra = join(legacyDir, "extra.txt");
      await writeFile(extra, "old extra file");
      await writeFile(
        join(legacyDir, "SKILL.md"),
        `---\nname: rulesync-interop\nsource: https://github.com/${repo}\nrepository: ${repo}\nref: old\n---\nlegacy\n`,
      );
      const lock = join(project, "rulesync-gh.lock.yaml");
      await writeFile(lock, "invalid old lock: [");
      await writeFile(
        join(project, "rulesync.jsonc"),
        JSON.stringify({
          sources: [
            { source: repo, ref: branch, skills: ["rulesync-interop"], agent: "claude-code" },
            { source: repo, ref: branch, skills: ["*"], agent: "universal", scope: "user" },
            { source: repo, skills: ["*"], agent: "universal" },
          ],
        }),
      );
      expect(await gh(["skill", "update", "--dry-run", "--all"])).toContain(
        "has no GitHub metadata",
      );
      await install();
      expect(await readFile(extra, "utf8")).toBe("old extra file");
      const list = JSON.parse(
        await gh(["skill", "list", "--json", "skillName,sourceURL,version,pinned,path"]),
      );
      expect(list).toHaveLength(3);
      for (const skill of list) {
        expect(skill).toMatchObject({
          skillName: "rulesync-interop",
          sourceURL: `https://github.com/${repo}`,
          version: branch,
          pinned: false,
        });
        expect(await readFile(join(skill.path, "SKILL.md"), "utf8")).toContain("github-tree-sha:");
      }
      expect(await readFile(lock, "utf8")).toBe("invalid old lock: [");
      await rm(lock);
      const nativeLock = JSON.parse(
        await readFile(join(home, ".agents", ".skill-lock.json"), "utf8"),
      );
      expect(nativeLock.skills["rulesync-interop"].source).toBe(repo);
      expect(await gh(["skill", "update", "--dry-run", "--all"])).not.toContain(
        "has no GitHub metadata",
      );
      const installedBefore = await readFile(join(legacyDir, "SKILL.md"), "utf8");
      expect(installedBefore).toContain("version-one");
      expect(installedBefore).not.toContain("\nrepository:");
      await publish("version-two", firstSha);
      expect(await gh(["skill", "update", "--dry-run", "--all"])).toContain("update(s) available");
      expect(await readFile(join(legacyDir, "SKILL.md"), "utf8")).toBe(installedBefore);
      expect(await gh(["skill", "update", "--all"])).toContain("Updated rulesync-interop");
      await expect(readFile(extra)).rejects.toMatchObject({ code: "ENOENT" });
      for (const skill of list) {
        expect(await readFile(join(skill.path, "SKILL.md"), "utf8")).toContain("version-two");
      }
      await expect(install(["--frozen"])).rejects.toThrow("--frozen is not supported");
      await expect(install(["--update"])).rejects.toThrow("--update is not supported");
      await install();
      await expect(readFile(lock)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);
