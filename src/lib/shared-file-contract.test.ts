import { join } from "node:path";

import { load as loadYaml } from "js-yaml";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Config } from "../config/config.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { generate } from "./generate.js";
import {
  deriveSharedFileWriters,
  SHARED_WRITE_FEATURE_ORDER,
  type SharedFileWriter,
} from "./shared-file-derive.js";

const parseSharedFile = (relativeFilePath: string, content: string): unknown => {
  if (relativeFilePath.endsWith(".toml")) return parseToml(content);
  if (relativeFilePath.endsWith(".yaml") || relativeFilePath.endsWith(".yml")) {
    return loadYaml(content);
  }
  return parseJsonc(content);
};

const collectKeyPaths = (value: unknown, prefix = ""): string[] => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix === "" ? [] : [prefix];
  }
  const paths = prefix === "" ? [] : [prefix];
  for (const [key, nested] of Object.entries(value)) {
    paths.push(...collectKeyPaths(nested, prefix === "" ? key : `${prefix}.${key}`));
  }
  return paths;
};

const sharedWriteTargets = (writers: SharedFileWriter[]): ToolTarget[] => [
  ...new Set(writers.flatMap((writer) => [...writer.toolsByFeature.values()].flat())),
];

const expectFilesSeen = (seenKeyPaths: Map<string, Set<string>>, keys: string[]): void => {
  // Sanity guard: the fixture must actually exercise the multi-format core
  // of the shared-write surface; an empty pass would prove nothing.
  const missing = keys.filter((key) => !seenKeyPaths.has(key));
  expect(
    missing,
    `expected shared files to be generated; observed: ${[...seenKeyPaths.keys()].toSorted().join(", ")}`,
  ).toEqual([]);
};

// Some tools declare a `.json` settable path but write a `.jsonc` twin by
// default (opencode, kilo), so probe both spellings for the on-disk file.
const candidateFileNames = (relativeFilePath: string): string[] => {
  if (relativeFilePath.endsWith(".jsonc")) {
    return [relativeFilePath, relativeFilePath.replace(/\.jsonc$/, ".json")];
  }
  if (relativeFilePath.endsWith(".json")) {
    return [relativeFilePath, `${relativeFilePath}c`];
  }
  return [relativeFilePath];
};

/**
 * Cross-feature merge contract for shared config files, derived from the
 * processor registry: run the real generation pipeline one shared-write
 * feature at a time, in the canonical write order, and assert that no step
 * deletes a key path an earlier step wrote to any shared file. Every tool that
 * declares a shared settable path is covered automatically — a new tool whose
 * read-modify-write clobbers a sibling feature's keys (the historical takt
 * `provider_options` and amp merge-order class of bugs) fails here without a
 * hand-written per-tool regression test.
 *
 * Arrays are treated as leaf values: a later feature may legitimately rewrite
 * an array it merges into (e.g. permissions overriding ignore-derived
 * `Read(...)` denies in `.claude/settings.json`), but the key path holding it
 * must survive. Ownership rules *within* such arrays are per-tool policy and
 * are covered by the tool-specific tests (e.g. `claudecode-settings-gateway`).
 */
describe("shared-file cross-feature write contract", () => {
  let projectDir: string;
  let cleanupProject: () => Promise<void>;
  let homeDir: string;
  let cleanupHome: () => Promise<void>;
  let previousHomeDirEnv: string | undefined;

  beforeEach(async () => {
    ({ testDir: projectDir, cleanup: cleanupProject } = await setupTestDirectory());
    ({ testDir: homeDir, cleanup: cleanupHome } = await setupTestDirectory({ home: true }));
    vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    // getHomeDirectory() respects HOME_DIR regardless of NODE_ENV; global-scope
    // writers resolve their paths against it.
    previousHomeDirEnv = process.env.HOME_DIR;
    process.env.HOME_DIR = homeDir;
  });

  afterEach(async () => {
    if (previousHomeDirEnv === undefined) {
      delete process.env.HOME_DIR;
    } else {
      process.env.HOME_DIR = previousHomeDirEnv;
    }
    await cleanupProject();
    await cleanupHome();
    vi.restoreAllMocks();
  });

  const writeFixtures = async (): Promise<void> => {
    await writeFileContent(
      join(projectDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
      ".env\nsecrets/**\n",
    );
    await writeFileContent(
      join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: {
          "contract-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
        },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {
          bash: { "git status *": "allow", "rm *": "deny" },
          read: { ".env.production": "deny" },
        },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md"),
      "---\nroot: true\n---\n\n# Overview rule\n",
    );
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
      "---\nroot: false\n---\n\n# Detail rule\n",
    );
  };

  /**
   * Run one shared-write feature at a time in the canonical order and return,
   * per shared file (under `fileRoot`), the key paths observed after the final
   * step. Fails the test as soon as a step deletes a previously seen key path.
   */
  const runContract = async ({
    global,
    fileRoot,
  }: {
    global: boolean;
    fileRoot: string;
  }): Promise<Map<string, Set<string>>> => {
    await writeFixtures();

    const writers = deriveSharedFileWriters();
    const targets = sharedWriteTargets(writers);
    const seenKeyPaths = new Map<string, Set<string>>();

    for (const feature of SHARED_WRITE_FEATURE_ORDER) {
      const config = new Config({
        outputRoots: [fileRoot],
        targets,
        features: [feature],
        inputRoot: projectDir,
        global,
        verbose: false,
        delete: false,
      });
      await generate({ config, logger: createMockLogger() });

      for (const writer of writers) {
        let filePath: string | undefined;
        for (const fileName of candidateFileNames(writer.relativeFilePath)) {
          const candidate = join(fileRoot, writer.relativeDirPath, fileName);
          if (await fileExists(candidate)) {
            filePath = candidate;
            break;
          }
        }
        if (!filePath) continue;
        const parsed = parseSharedFile(writer.relativeFilePath, await readFileContent(filePath));
        const keyPaths = new Set(collectKeyPaths(parsed));
        const before = seenKeyPaths.get(writer.key) ?? new Set<string>();
        const deleted = [...before].filter((path) => !keyPaths.has(path));
        expect(
          deleted,
          `generation step '${feature}' deleted key paths from shared file '${writer.key}'`,
        ).toEqual([]);
        seenKeyPaths.set(writer.key, keyPaths);
      }
    }

    return seenKeyPaths;
  };

  it("no generation step deletes another step's key paths (project scope)", async () => {
    const seenKeyPaths = await runContract({ global: false, fileRoot: projectDir });
    expectFilesSeen(seenKeyPaths, [
      ".claude/settings.json",
      ".codex/config.toml",
      ".takt/config.yaml",
      ".zed/settings.json",
      "kilo.json",
      "opencode.json",
    ]);
  }, 120_000);

  it("no generation step deletes another step's key paths (global scope)", async () => {
    const seenKeyPaths = await runContract({ global: true, fileRoot: homeDir });
    expectFilesSeen(seenKeyPaths, [".hermes/config.yaml", ".config/opencode/opencode.json"]);
  }, 120_000);
});
