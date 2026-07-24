import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { fetchCommand } from "../cli/commands/fetch.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { fileExists, readFileContent } from "../utils/file.js";
import { useTestDirectory } from "./e2e-helper.js";

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
            path: "rules/overview.md",
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
            path: "skills/test-skill",
            type: "dir",
            sha: "skill-dir-sha",
            size: 0,
            download_url: null,
          },
        ]);
      }
      if (path === "skills/test-skill") {
        return Promise.resolve([
          {
            name: SKILL_FILE_NAME,
            path: `skills/test-skill/${SKILL_FILE_NAME}`,
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
      if (path === `skills/test-skill/${SKILL_FILE_NAME}`) {
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

  it("should make omitted features equivalent to explicit skills for a mixed repository", async () => {
    const testDir = getTestDir();
    const defaultLogger = { ...createMockLogger(), jsonMode: true };
    const explicitLogger = createMockLogger();

    await fetchCommand(defaultLogger, { source: "owner/repo" });
    await fetchCommand(explicitLogger, {
      source: "owner/repo",
      features: ["skills"],
      output: "explicit",
    });

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

    expect(defaultLogger.success).toHaveBeenCalledWith(
      expect.stringContaining(`skills/test-skill/${SKILL_FILE_NAME} (created)`),
    );
    expect(defaultLogger.captureData).toHaveBeenCalledWith("created", [
      `skills/test-skill/${SKILL_FILE_NAME}`,
    ]);
    expect(defaultLogger.captureData).toHaveBeenCalledWith("totalFetched", 1);
  });
});
