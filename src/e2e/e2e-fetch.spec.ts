import { join, posix } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../cli/program.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { useTestDirectory } from "./e2e-helper.js";

const REMOTE_RULE_PATH = posix.join("rules", "overview.md");
const REMOTE_SKILL_DIR_PATH = posix.join("skills", "test-skill");
const REMOTE_SKILL_PATH = posix.join(REMOTE_SKILL_DIR_PATH, SKILL_FILE_NAME);

vi.mock("../lib/github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken(): undefined {
      return undefined;
    }

    validateRepository(): Promise<boolean> {
      return Promise.resolve(true);
    }

    getDefaultBranch(): Promise<string> {
      return Promise.resolve("main");
    }

    listDirectory(
      _owner: string,
      _repo: string,
      path: string,
    ): Promise<
      Array<{
        name: string;
        path: string;
        type: "file" | "dir";
        sha: string;
        size: number;
        download_url: string | null;
      }>
    > {
      if (path === "rules") {
        return Promise.resolve([
          {
            name: "overview.md",
            path: REMOTE_RULE_PATH,
            type: "file",
            sha: "rule-sha",
            size: 20,
            download_url: "https://example.com/rules/overview.md",
          },
        ]);
      }
      if (path === "skills") {
        return Promise.resolve([
          {
            name: "test-skill",
            path: REMOTE_SKILL_DIR_PATH,
            type: "dir",
            sha: "skill-dir-sha",
            size: 0,
            download_url: null,
          },
        ]);
      }
      if (path === REMOTE_SKILL_DIR_PATH) {
        return Promise.resolve([
          {
            name: SKILL_FILE_NAME,
            path: REMOTE_SKILL_PATH,
            type: "file",
            sha: "skill-file-sha",
            size: 30,
            download_url: `https://example.com/skills/test-skill/${SKILL_FILE_NAME}`,
          },
        ]);
      }

      const error = new Error("Not found");
      Object.assign(error, { statusCode: 404 });
      return Promise.reject(error);
    }

    getFileContent(_owner: string, _repo: string, path: string): Promise<string> {
      if (path === REMOTE_SKILL_PATH) {
        return Promise.resolve("# Test Skill\n");
      }
      if (path === "rules/overview.md") {
        return Promise.resolve("# Overview\n");
      }
      return Promise.resolve("");
    }
  },
  GitHubClientError: class GitHubClientError extends Error {
    constructor(
      message: string,
      public readonly statusCode?: number,
    ) {
      super(message);
    }
  },
}));

describe("E2E: fetch", () => {
  const { getTestDir } = useTestDirectory();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should make omitted features equivalent to explicit skills for a mixed repository", async () => {
    const testDir = getTestDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync(["node", "rulesync", "--json", "fetch", "owner/repo"]);
    const defaultOutput = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      data: { created: string[]; totalFetched: number };
    };

    await createProgram().parseAsync([
      "node",
      "rulesync",
      "--json",
      "fetch",
      "owner/repo",
      "-f",
      "skills",
      "--output",
      "explicit",
    ]);
    const explicitOutput = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      data: { created: string[]; totalFetched: number };
    };

    const defaultSkillPath = join(
      testDir,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      "test-skill",
      SKILL_FILE_NAME,
    );
    const explicitSkillPath = join(testDir, "explicit", "skills", "test-skill", SKILL_FILE_NAME);

    expect(await readFileContent(defaultSkillPath)).toBe("# Test Skill\n");
    expect(await readFileContent(explicitSkillPath)).toBe("# Test Skill\n");
    expect(await fileExists(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md"))).toBe(
      false,
    );
    expect(await fileExists(join(testDir, "explicit", "rules", "overview.md"))).toBe(false);

    expect(defaultOutput.data).toMatchObject({
      created: [REMOTE_SKILL_PATH],
      totalFetched: 1,
    });
    expect(explicitOutput.data).toMatchObject({
      created: [REMOTE_SKILL_PATH],
      totalFetched: 1,
    });
  });

  it("should delete a stale file inside a fetched skill and keep it with --no-prune", async () => {
    const testDir = getTestDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stalePath = join(
      testDir,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      "test-skill",
      "reference.md",
    );
    const staleRelativePath = posix.join(REMOTE_SKILL_DIR_PATH, "reference.md");

    await writeFileContent(stalePath, "# Dropped upstream\n");
    await createProgram().parseAsync(["node", "rulesync", "--json", "fetch", "owner/repo"]);
    const prunedOutput = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      data: { created: string[]; deleted: string[] };
    };

    expect(prunedOutput.data).toMatchObject({ deleted: [staleRelativePath] });
    expect(await fileExists(stalePath)).toBe(false);
    expect(
      await readFileContent(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", SKILL_FILE_NAME),
      ),
    ).toBe("# Test Skill\n");

    await writeFileContent(stalePath, "# Dropped upstream\n");
    await createProgram().parseAsync([
      "node",
      "rulesync",
      "--json",
      "fetch",
      "owner/repo",
      "--no-prune",
    ]);
    const keptOutput = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      data: { deleted: string[] };
    };

    expect(keptOutput.data).toMatchObject({ deleted: [] });
    expect(await fileExists(stalePath)).toBe(true);
  });
});
