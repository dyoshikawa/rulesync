import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Config } from "../../config/config.js";
import { RULESYNC_CURATED_PLUGINS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { installPlugins } from "./install-plugins.js";
import { readPluginLock } from "./plugin-lock.js";

let mockClientInstance: {
  getDefaultBranch: (...args: unknown[]) => unknown;
  resolveRefToSha: (...args: unknown[]) => unknown;
  listDirectory: (...args: unknown[]) => unknown;
  getFileContent: (...args: unknown[]) => unknown;
};

const { getHomeDirectoryMock } = vi.hoisted(() => {
  return {
    getHomeDirectoryMock: vi.fn(),
  };
});

vi.mock("../github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn().mockReturnValue(undefined);

    getDefaultBranch(...args: unknown[]) {
      return mockClientInstance.getDefaultBranch(...args);
    }
    resolveRefToSha(...args: unknown[]) {
      return mockClientInstance.resolveRefToSha(...args);
    }
    listDirectory(...args: unknown[]) {
      return mockClientInstance.listDirectory(...args);
    }
    getFileContent(...args: unknown[]) {
      return mockClientInstance.getFileContent(...args);
    }
  },
  GitHubClientError: class GitHubClientError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  logGitHubAuthHints: vi.fn(),
}));

vi.mock("../../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/file.js")>("../../utils/file.js");
  return {
    ...actual,
    getHomeDirectory: getHomeDirectoryMock,
  };
});

describe("installPlugins", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let homeDir: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    homeDir = testDir;
    getHomeDirectoryMock.mockReturnValue(homeDir);
    mockClientInstance = {
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      resolveRefToSha: vi.fn().mockResolvedValue("a".repeat(40)),
      listDirectory: vi
        .fn()
        .mockImplementation(async (_owner: string, _repo: string, path: string) => {
          if (path === "skills") {
            return [{ name: "plugin-skill", path: "skills/plugin-skill", type: "dir", size: 0 }];
          }
          if (path === "skills/plugin-skill") {
            return [
              {
                name: "SKILL.md",
                path: "skills/plugin-skill/SKILL.md",
                type: "file",
                size: 32,
              },
            ];
          }
          return [];
        }),
      getFileContent: vi
        .fn()
        .mockResolvedValue("---\nname: plugin-skill\ndescription: test\n---\nbody\n"),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    getHomeDirectoryMock.mockClear();
  });

  it("fetches a declared codexcli plugin, deploys it to user skills, and writes the plugin lock", async () => {
    const config = new Config({
      outputRoots: [testDir],
      targets: ["codexcli"],
      features: ["plugins"],
      targetFeatures: {
        codexcli: ["plugins"],
      },
      verbose: false,
      delete: false,
      silent: false,
      inputRoot: testDir,
      sources: [
        {
          source: "obra/superpowers",
          ref: "main",
          plugins: [
            {
              name: "superpowers",
              targets: ["codexcli"],
              codexcli: {
                artifact: {
                  kind: "skillsBundle",
                  path: "skills",
                },
                install: {
                  strategy: "userSkillsDir",
                },
              },
            },
          ],
        },
      ],
    });

    const result = await installPlugins({
      config,
      projectRoot: testDir,
      logger: createMockLogger(),
    });

    expect(result).toEqual({
      installedPluginCount: 1,
      installedFileCount: 1,
      sourcesProcessed: 1,
      localPluginsProcessed: 0,
    });

    const deployedPath = join(homeDir, ".codex", "skills", "plugin-skill", "SKILL.md");
    expect(await fileExists(deployedPath)).toBe(true);
    expect(await readFileContent(deployedPath)).toContain("name: plugin-skill");

    const curatedPath = join(
      testDir,
      RULESYNC_CURATED_PLUGINS_RELATIVE_DIR_PATH,
      "superpowers",
      "skills",
      "plugin-skill",
      "SKILL.md",
    );
    expect(await fileExists(curatedPath)).toBe(true);

    const lock = await readPluginLock(testDir);
    expect(lock?.installations).toHaveLength(1);
    expect(lock?.installations[0]?.plugin).toBe("superpowers");
    expect(lock?.installations[0]?.target).toBe("codexcli");
  });

  it("fetches a declared claudecode plugin, deploys it to user skills, and writes the plugin lock", async () => {
    const config = new Config({
      outputRoots: [testDir],
      targets: ["claudecode"],
      features: ["plugins"],
      targetFeatures: {
        claudecode: ["plugins"],
      },
      verbose: false,
      delete: false,
      silent: false,
      inputRoot: testDir,
      sources: [
        {
          source: "obra/superpowers",
          ref: "main",
          plugins: [
            {
              name: "superpowers",
              targets: ["claudecode"],
              claudecode: {
                artifact: {
                  kind: "skillsBundle",
                  path: "skills",
                },
                install: {
                  strategy: "userSkillsDir",
                },
              },
            },
          ],
        },
      ],
    });

    const result = await installPlugins({
      config,
      projectRoot: testDir,
      logger: createMockLogger(),
    });

    expect(result).toEqual({
      installedPluginCount: 1,
      installedFileCount: 1,
      sourcesProcessed: 1,
      localPluginsProcessed: 0,
    });

    const deployedPath = join(homeDir, ".claude", "skills", "plugin-skill", "SKILL.md");
    expect(await fileExists(deployedPath)).toBe(true);
    expect(await readFileContent(deployedPath)).toContain("name: plugin-skill");

    const curatedPath = join(
      testDir,
      RULESYNC_CURATED_PLUGINS_RELATIVE_DIR_PATH,
      "superpowers",
      "skills",
      "plugin-skill",
      "SKILL.md",
    );
    expect(await fileExists(curatedPath)).toBe(true);

    const lock = await readPluginLock(testDir);
    expect(lock?.installations).toHaveLength(1);
    expect(lock?.installations[0]?.plugin).toBe("superpowers");
    expect(lock?.installations[0]?.target).toBe("claudecode");
    expect(lock?.installations[0]?.install_dir).toBe(join(homeDir, ".claude", "skills"));
  });

  it("installs both codexcli and claudecode for a plugin that supports both targets", async () => {
    const config = new Config({
      outputRoots: [testDir],
      targets: ["codexcli", "claudecode"],
      features: ["plugins"],
      targetFeatures: {
        codexcli: ["plugins"],
        claudecode: ["plugins"],
      },
      verbose: false,
      delete: false,
      silent: false,
      inputRoot: testDir,
      sources: [
        {
          source: "obra/superpowers",
          ref: "main",
          plugins: [
            {
              name: "superpowers",
              targets: ["codexcli", "claudecode"],
              codexcli: {
                artifact: {
                  kind: "skillsBundle",
                  path: "skills",
                },
                install: {
                  strategy: "userSkillsDir",
                },
              },
              claudecode: {
                artifact: {
                  kind: "skillsBundle",
                  path: "skills",
                },
                install: {
                  strategy: "userSkillsDir",
                },
              },
            },
          ],
        },
      ],
    });

    const result = await installPlugins({
      config,
      projectRoot: testDir,
      logger: createMockLogger(),
    });

    expect(result.installedPluginCount).toBe(2);
    expect(result.installedFileCount).toBe(2);

    expect(await fileExists(join(homeDir, ".codex", "skills", "plugin-skill", "SKILL.md"))).toBe(
      true,
    );
    expect(await fileExists(join(homeDir, ".claude", "skills", "plugin-skill", "SKILL.md"))).toBe(
      true,
    );

    const lock = await readPluginLock(testDir);
    expect(lock?.installations).toHaveLength(2);
    const targets = lock?.installations.map((i) => i.target).toSorted();
    expect(targets).toEqual(["claudecode", "codexcli"]);
  });

  it("installs local plugins with higher precedence than curated ones", async () => {
    await writeFileContent(
      join(testDir, ".rulesync", "plugins", "superpowers", "plugin.jsonc"),
      JSON.stringify({
        name: "superpowers",
        targets: ["codexcli"],
        codexcli: {
          artifact: {
            kind: "skillsBundle",
            path: "skills",
          },
          install: {
            strategy: "userSkillsDir",
          },
        },
      }),
    );
    await writeFileContent(
      join(testDir, ".rulesync", "plugins", "superpowers", "skills", "local-skill", "SKILL.md"),
      "---\nname: local-skill\ndescription: local\n---\nlocal\n",
    );

    const config = new Config({
      outputRoots: [testDir],
      targets: ["codexcli"],
      features: ["plugins"],
      targetFeatures: {
        codexcli: ["plugins"],
      },
      verbose: false,
      delete: false,
      silent: false,
      inputRoot: testDir,
      sources: [
        {
          source: "obra/superpowers",
          ref: "main",
          plugins: [
            {
              name: "superpowers",
              targets: ["codexcli"],
              codexcli: {
                artifact: {
                  kind: "skillsBundle",
                  path: "skills",
                },
                install: {
                  strategy: "userSkillsDir",
                },
              },
            },
          ],
        },
      ],
    });

    const result = await installPlugins({
      config,
      projectRoot: testDir,
      logger: createMockLogger(),
    });

    expect(result.installedPluginCount).toBe(1);
    expect(await fileExists(join(homeDir, ".codex", "skills", "local-skill", "SKILL.md"))).toBe(
      true,
    );
    expect(await fileExists(join(homeDir, ".codex", "skills", "plugin-skill", "SKILL.md"))).toBe(
      false,
    );
  });
});
