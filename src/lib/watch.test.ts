import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { statSyncMock } = vi.hoisted(() => ({ statSyncMock: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  statSyncMock.mockImplementation(actual.statSync);
  return { ...actual, statSync: statSyncMock };
});

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  buildConfigFilePaths,
  buildWatchTargets,
  DEFAULT_WATCH_DEBOUNCE_MS,
  formatTriggerPaths,
  WatchScheduler,
  watchTargets,
} from "./watch.js";

/**
 * Resolves once `predicate` holds, polling on real timers. Used for the
 * `fs.watch` integration test, where event delivery latency is platform
 * dependent.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("WatchScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("coalesces a burst of notifications into a single run", async () => {
    vi.useFakeTimers();
    const runs: string[][] = [];
    const scheduler = new WatchScheduler({
      run: async ({ triggers }) => {
        runs.push(triggers);
      },
      onError: () => {},
      debounceMs: 50,
    });

    scheduler.notify({ path: "/a.md" });
    scheduler.notify({ path: "/b.md" });
    scheduler.notify({ path: "/a.md" });

    await vi.advanceTimersByTimeAsync(49);
    expect(runs).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual([["/a.md", "/b.md"]]);

    await scheduler.close();
  });

  it("restarts the debounce window while events keep arriving", async () => {
    vi.useFakeTimers();
    const runs: string[][] = [];
    const scheduler = new WatchScheduler({
      run: async ({ triggers }) => {
        runs.push(triggers);
      },
      onError: () => {},
      debounceMs: 50,
    });

    scheduler.notify({ path: "/a.md" });
    await vi.advanceTimersByTimeAsync(40);
    scheduler.notify({ path: "/b.md" });
    await vi.advanceTimersByTimeAsync(40);
    expect(runs).toEqual([]);

    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toEqual([["/a.md", "/b.md"]]);

    await scheduler.close();
  });

  it("never overlaps runs and re-runs once for changes that arrive mid-run", async () => {
    vi.useFakeTimers();
    const runs: string[][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirstRun: (() => void) | undefined;

    const scheduler = new WatchScheduler({
      run: async ({ triggers }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        runs.push(triggers);
        if (runs.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstRun = resolve;
          });
        }
        inFlight -= 1;
      },
      onError: () => {},
      debounceMs: 50,
    });

    scheduler.notify({ path: "/a.md" });
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toEqual([["/a.md"]]);

    // Two more bursts land while the first run is still in flight.
    scheduler.notify({ path: "/b.md" });
    await vi.advanceTimersByTimeAsync(50);
    scheduler.notify({ path: "/c.md" });
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toHaveLength(1);

    releaseFirstRun?.();
    await vi.advanceTimersByTimeAsync(50);

    expect(runs).toEqual([["/a.md"], ["/b.md", "/c.md"]]);
    expect(maxInFlight).toBe(1);

    await scheduler.close();
  });

  it("reports a failing run and keeps accepting further changes", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    const runs: string[][] = [];
    const scheduler = new WatchScheduler({
      run: async ({ triggers }) => {
        runs.push(triggers);
        if (runs.length === 1) {
          throw new Error("invalid frontmatter");
        }
      },
      onError: ({ error }) => {
        errors.push(error);
      },
      debounceMs: 50,
    });

    scheduler.notify({ path: "/a.md" });
    await vi.advanceTimersByTimeAsync(50);
    scheduler.notify({ path: "/b.md" });
    await vi.advanceTimersByTimeAsync(50);

    expect(runs).toEqual([["/a.md"], ["/b.md"]]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("invalid frontmatter");

    await scheduler.close();
  });

  it("ignores notifications after close and drops pending ones", async () => {
    vi.useFakeTimers();
    const runs: string[][] = [];
    const scheduler = new WatchScheduler({
      run: async ({ triggers }) => {
        runs.push(triggers);
      },
      onError: () => {},
      debounceMs: 50,
    });

    scheduler.notify({ path: "/a.md" });
    await scheduler.close();
    scheduler.notify({ path: "/b.md" });
    await vi.advanceTimersByTimeAsync(500);

    expect(runs).toEqual([]);
  });

  it("waits for an in-flight run to settle on close", async () => {
    let finished = false;
    let releaseRun: (() => void) | undefined;
    const scheduler = new WatchScheduler({
      run: async () => {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        finished = true;
      },
      onError: () => {},
      debounceMs: 1,
    });

    scheduler.notify({ path: "/a.md" });
    await waitFor(() => releaseRun !== undefined);

    const closed = scheduler.close();
    releaseRun?.();
    await closed;

    expect(finished).toBe(true);
  });

  it("defaults to a 300ms debounce window", () => {
    expect(DEFAULT_WATCH_DEBOUNCE_MS).toBe(300);
  });
});

describe("buildWatchTargets", () => {
  it("watches the .rulesync tree recursively and the config files only", () => {
    const inputRoot = join("/", "repo");
    const targets = buildWatchTargets({
      inputRoot,
      configFilePath: join(inputRoot, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
    });

    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({
      directory: join(inputRoot, RULESYNC_RELATIVE_DIR_PATH),
      recursive: true,
    });

    const configTarget = targets[1];
    expect(configTarget?.directory).toBe(inputRoot);
    expect(configTarget?.recursive).toBe(false);
    expect(configTarget?.include?.(RULESYNC_CONFIG_RELATIVE_FILE_PATH)).toBe(true);
    expect(configTarget?.include?.(RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH)).toBe(true);
    // Generated output next to the config file must not trigger a regeneration.
    expect(configTarget?.include?.("AGENTS.md")).toBe(false);
    expect(configTarget?.include?.("CLAUDE.md")).toBe(false);
  });

  it("watches the directory holding a config file outside the input root", () => {
    const inputRoot = join("/", "repo");
    const targets = buildWatchTargets({
      inputRoot,
      configFilePath: join(inputRoot, "config", "custom.jsonc"),
    });

    const configTarget = targets[1];
    expect(configTarget?.directory).toBe(join(inputRoot, "config"));
    expect(configTarget?.include?.("custom.jsonc")).toBe(true);
    expect(configTarget?.include?.(RULESYNC_CONFIG_RELATIVE_FILE_PATH)).toBe(false);
  });
});

describe("buildConfigFilePaths", () => {
  it("covers the base config file and the local override next to it", () => {
    const configFilePath = join("/", "repo", RULESYNC_CONFIG_RELATIVE_FILE_PATH);

    expect(buildConfigFilePaths({ configFilePath })).toEqual(
      new Set([configFilePath, join("/", "repo", RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH)]),
    );
  });
});

describe("formatTriggerPaths", () => {
  const baseDir = join("/", "repo");

  it("renders paths relative to the base directory", () => {
    expect(
      formatTriggerPaths({
        triggers: [join(baseDir, ".rulesync", "rules", "a.md")],
        baseDir,
      }),
    ).toBe(join(".rulesync", "rules", "a.md"));
  });

  it("truncates long bursts", () => {
    const triggers = Array.from({ length: 7 }, (_, index) =>
      join(baseDir, ".rulesync", "rules", `rule-${index}.md`),
    );

    const formatted = formatTriggerPaths({ triggers, baseDir, max: 2 });

    expect(formatted).toBe(
      `${join(".rulesync", "rules", "rule-0.md")}, ${join(".rulesync", "rules", "rule-1.md")} (+5 more)`,
    );
  });

  it("falls back to the absolute path when it equals the base directory", () => {
    expect(formatTriggerPaths({ triggers: [baseDir], baseDir })).toBe(baseDir);
  });
});

describe("watchTargets", () => {
  // The fs.watch integration tests depend on OS event delivery, which can
  // stall for seconds on loaded CI runners; the default 5s per-test timeout
  // has produced repeated flakes there (each `waitFor` already polls with its
  // own 10s budget).
  const FS_EVENT_TEST_TIMEOUT_MS = 20000;

  it(
    "forwards changes under a recursively watched directory",
    { timeout: FS_EVENT_TEST_TIMEOUT_MS },
    async () => {
      const { testDir, cleanup } = await setupTestDirectory();
      try {
        const rulesDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH, "rules");
        await mkdir(rulesDir, { recursive: true });

        const changed: string[] = [];
        const handle = watchTargets({
          targets: [{ directory: join(testDir, RULESYNC_RELATIVE_DIR_PATH), recursive: true }],
          onChange: ({ path }) => {
            changed.push(path);
          },
          onError: () => {},
        });

        try {
          await writeFile(join(rulesDir, "watched.md"), "# watched\n", "utf8");
          await waitFor(() => changed.some((path) => path.includes("watched.md")));
        } finally {
          handle.close();
        }
      } finally {
        await cleanup();
      }
    },
  );

  it(
    "re-attaches after the watched directory is deleted and recreated",
    { timeout: FS_EVENT_TEST_TIMEOUT_MS },
    async () => {
      const { testDir, cleanup } = await setupTestDirectory();
      try {
        const watchedDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
        await mkdir(join(watchedDir, "rules"), { recursive: true });

        const changed: string[] = [];
        const handle = watchTargets({
          targets: [{ directory: watchedDir, recursive: true }],
          onChange: ({ path }) => {
            changed.push(path);
          },
          onError: () => {},
          rearmIntervalMs: 25,
        });

        try {
          // A branch switch that drops `.rulesync/` kills the underlying inode
          // watch; without re-arming, nothing below would ever be reported.
          await rm(watchedDir, { recursive: true, force: true });
          await waitFor(() => changed.length > 0);

          changed.length = 0;
          await mkdir(join(watchedDir, "rules"), { recursive: true });
          await waitFor(() => changed.length > 0);

          changed.length = 0;
          await writeFile(join(watchedDir, "rules", "after-rearm.md"), "# after\n", "utf8");
          await waitFor(() => changed.some((path) => path.includes("after-rearm.md")));
        } finally {
          handle.close();
        }
      } finally {
        await cleanup();
      }
    },
  );

  it(
    "re-attaches a filtered target after its directory is deleted and recreated",
    { timeout: FS_EVENT_TEST_TIMEOUT_MS },
    async () => {
      const { testDir, cleanup } = await setupTestDirectory();
      try {
        const configDir = join(testDir, "packages", "app");
        await mkdir(configDir, { recursive: true });

        const changed: string[] = [];
        const handle = watchTargets({
          targets: [
            {
              directory: configDir,
              recursive: false,
              include: (relativePath) => relativePath === RULESYNC_CONFIG_RELATIVE_FILE_PATH,
            },
          ],
          onChange: ({ path }) => {
            changed.push(path);
          },
          onError: () => {},
          rearmIntervalMs: 25,
        });

        try {
          // The last event a deleted directory emits names the directory
          // itself, which the include filter rejects — re-arming must still
          // kick in.
          await rm(configDir, { recursive: true, force: true });
          await mkdir(configDir, { recursive: true });

          changed.length = 0;
          await waitFor(() => changed.length > 0);

          changed.length = 0;
          await writeFile(join(configDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH), "{}\n", "utf8");
          await waitFor(() =>
            changed.some((path) => path.endsWith(RULESYNC_CONFIG_RELATIVE_FILE_PATH)),
          );
        } finally {
          handle.close();
        }
      } finally {
        await cleanup();
      }
    },
  );

  it("re-attaches when the watched directory is replaced before its delete event arrives", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const configDir = join(testDir, "packages", "app");
      await mkdir(configDir, { recursive: true });

      const changed: string[] = [];
      const handle = watchTargets({
        targets: [
          {
            directory: configDir,
            recursive: false,
            include: (relativePath) => relativePath === RULESYNC_CONFIG_RELATIVE_FILE_PATH,
          },
        ],
        onChange: ({ path }) => {
          changed.push(path);
        },
        onError: () => {},
        rearmIntervalMs: 25,
      });

      try {
        // Simulate a delete+recreate whose delete event was not delivered
        // yet: the path still exists, but its inode no longer matches the
        // one recorded at attach time. An events-only existence check would
        // keep the dead watcher forever; the inode comparison must re-arm.
        statSyncMock.mockReturnValue({ ino: 999_999_999n });
        // Any event — even one the include filter rejects — runs the
        // liveness check.
        await writeFile(join(configDir, "decoy.md"), "# decoy\n", "utf8");
        await waitFor(() => changed.includes(configDir));
      } finally {
        statSyncMock.mockImplementation(actual.statSync);
        handle.close();
      }
    } finally {
      await cleanup();
    }
  });

  it("closes already-started watchers when a later target cannot be watched", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const watchedDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await mkdir(watchedDir, { recursive: true });

      const changed: string[] = [];
      expect(() =>
        watchTargets({
          targets: [
            { directory: watchedDir, recursive: true },
            { directory: join(testDir, "missing-directory"), recursive: false },
          ],
          onChange: ({ path }) => {
            changed.push(path);
          },
          onError: () => {},
        }),
      ).toThrow();

      // The first watcher must have been closed, so later writes are silent.
      await writeFile(join(watchedDir, "orphan.md"), "# orphan\n", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(changed).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("skips events that the include filter rejects", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const changed: string[] = [];
      const handle = watchTargets({
        targets: [
          {
            directory: testDir,
            recursive: false,
            include: (relativePath) => relativePath === RULESYNC_CONFIG_RELATIVE_FILE_PATH,
          },
        ],
        onChange: ({ path }) => {
          changed.push(path);
        },
        onError: () => {},
      });

      try {
        await writeFile(join(testDir, "AGENTS.md"), "# generated\n", "utf8");
        await writeFile(join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH), "{}\n", "utf8");
        await waitFor(() =>
          changed.some((path) => path.endsWith(RULESYNC_CONFIG_RELATIVE_FILE_PATH)),
        );
        expect(changed.some((path) => path.endsWith("AGENTS.md"))).toBe(false);
      } finally {
        handle.close();
      }
    } finally {
      await cleanup();
    }
  });
});
