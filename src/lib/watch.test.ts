import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { statSyncMock, fsWatchMock } = vi.hoisted(() => ({
  statSyncMock: vi.fn(),
  fsWatchMock: vi.fn(),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  statSyncMock.mockImplementation(actual.statSync);
  fsWatchMock.mockImplementation(actual.watch);
  return { ...actual, statSync: statSyncMock, watch: fsWatchMock };
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

/**
 * Like `waitFor`, but re-runs `probe` before every check. Used after a
 * watched directory is deleted and recreated: a one-shot trigger can land in
 * the unwatched gap between the detach and the timer-driven re-attach, so
 * the side effect must be re-applied until the watcher reports it.
 */
async function waitForWithProbe({
  probe,
  until,
  timeoutMs = 10000,
}: {
  probe: () => Promise<void>;
  until: () => boolean;
  timeoutMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    await probe();
    if (until()) {
      return;
    }
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
    const root = join("/", "repo");
    const sourceTree = join(root, RULESYNC_RELATIVE_DIR_PATH);
    const targets = buildWatchTargets({
      inputRoots: [sourceTree],
      configFilePath: join(root, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
    });

    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({
      directory: sourceTree,
      recursive: true,
    });

    const configTarget = targets[1];
    expect(configTarget?.directory).toBe(root);
    expect(configTarget?.recursive).toBe(false);
    expect(configTarget?.include?.(RULESYNC_CONFIG_RELATIVE_FILE_PATH)).toBe(true);
    expect(configTarget?.include?.(RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH)).toBe(true);
    // Generated output next to the config file must not trigger a regeneration.
    expect(configTarget?.include?.("AGENTS.md")).toBe(false);
    expect(configTarget?.include?.("CLAUDE.md")).toBe(false);
  });

  it("watches the directory holding a config file outside the input root", () => {
    const root = join("/", "repo");
    const targets = buildWatchTargets({
      inputRoots: [join(root, RULESYNC_RELATIVE_DIR_PATH)],
      configFilePath: join(root, "config", "custom.jsonc"),
    });

    const configTarget = targets[1];
    expect(configTarget?.directory).toBe(join(root, "config"));
    expect(configTarget?.include?.("custom.jsonc")).toBe(true);
    expect(configTarget?.include?.(RULESYNC_CONFIG_RELATIVE_FILE_PATH)).toBe(false);
  });

  it("emits one recursive watcher per input root", () => {
    const base = join("/", "team-config", RULESYNC_RELATIVE_DIR_PATH);
    const overlay = join("/", "repo", RULESYNC_RELATIVE_DIR_PATH);
    const targets = buildWatchTargets({
      inputRoots: [base, overlay],
      configFilePath: join("/", "repo", RULESYNC_CONFIG_RELATIVE_FILE_PATH),
    });

    expect(targets).toHaveLength(3);
    expect(targets[0]?.directory).toBe(base);
    expect(targets[1]?.directory).toBe(overlay);
    // The last entry is the config-file watcher.
    expect(targets[2]?.recursive).toBe(false);
  });

  it("dedupes duplicate roots", () => {
    const root = join("/", "repo");
    const sourceTree = join(root, RULESYNC_RELATIVE_DIR_PATH);
    const targets = buildWatchTargets({
      inputRoots: [sourceTree, sourceTree],
      configFilePath: join(root, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
    });

    expect(targets).toHaveLength(2);
    expect(targets[0]?.directory).toBe(sourceTree);
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

  it("renders paths relative to the containing input root", () => {
    expect(
      formatTriggerPaths({
        triggers: [join(baseDir, ".rulesync", "rules", "a.md")],
        inputRoots: [baseDir],
      }),
    ).toBe(join(".rulesync", "rules", "a.md"));
  });

  it("truncates long bursts", () => {
    const triggers = Array.from({ length: 7 }, (_, index) =>
      join(baseDir, ".rulesync", "rules", `rule-${index}.md`),
    );

    const formatted = formatTriggerPaths({ triggers, inputRoots: [baseDir], max: 2 });

    expect(formatted).toBe(
      `${join(".rulesync", "rules", "rule-0.md")}, ${join(".rulesync", "rules", "rule-1.md")} (+5 more)`,
    );
  });

  it("falls back to the absolute path for triggers outside every root", () => {
    expect(formatTriggerPaths({ triggers: [baseDir], inputRoots: [baseDir] })).toBe(baseDir);
  });

  it("picks the containing root when several are configured", () => {
    const base = join("/", "team-config");
    const overlay = join("/", "repo");
    expect(
      formatTriggerPaths({
        triggers: [
          join(base, ".rulesync", "rules", "a.md"),
          join(overlay, ".rulesync", "rules", "b.md"),
        ],
        inputRoots: [base, overlay],
      }),
    ).toBe(`${join(".rulesync", "rules", "a.md")}, ${join(".rulesync", "rules", "b.md")}`);
  });
});

describe("watchTargets", () => {
  // The fs.watch integration tests depend on OS event delivery, which can
  // stall for seconds on loaded CI runners; the default 5s per-test timeout
  // has produced repeated flakes there (each `waitFor` already polls with its
  // own 10s budget).
  const FS_EVENT_TEST_TIMEOUT_MS = 20000;

  it(
    "attaches when an optional target is created after watch startup",
    { timeout: FS_EVENT_TEST_TIMEOUT_MS },
    async () => {
      const { testDir, cleanup } = await setupTestDirectory();

      try {
        const watchedDir = join(testDir, ".rulesync.local");
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
          await mkdir(watchedDir, { recursive: true });
          await waitFor(() => changed.includes(watchedDir));

          changed.length = 0;
          await waitForWithProbe({
            probe: () => writeFile(join(watchedDir, "local.md"), "# local\n", "utf8"),
            until: () => changed.some((path) => path.includes("local.md")),
          });
        } finally {
          handle.close();
        }
      } finally {
        await cleanup();
      }
    },
  );

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
          // Probe at the watched root, not inside `rules/`: the re-attached
          // recursive watcher may register the freshly recreated subdirectory
          // late (kernel-level inotify race on loaded runners), and this test
          // asserts re-attachment, not recursive subdirectory coverage.
          // Re-write until observed: the wait above can be satisfied by a
          // late-delivered delete event while the watcher is still detached,
          // in which case a single write would land in the unwatched gap and
          // never be reported.
          await waitForWithProbe({
            probe: () => writeFile(join(watchedDir, "after-rearm.md"), "# after\n", "utf8"),
            until: () => changed.some((path) => path.includes("after-rearm.md")),
          });
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

          // Re-attachment cannot be awaited on its own: both the detach and
          // the re-attach notify with the directory path, and either can fire
          // while the rm/mkdir promises above are still settling — clearing
          // `changed` afterwards would then wait forever on a watcher that is
          // already healthy. Prove re-attachment by probing instead: only an
          // attached watcher reports the config file's own path, and
          // re-writing covers a write landing in the unwatched gap before the
          // timer-driven re-attach.
          const configFilePath = join(configDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH);
          await waitForWithProbe({
            probe: () => writeFile(configFilePath, "{}\n", "utf8"),
            until: () => changed.some((path) => path.endsWith(RULESYNC_CONFIG_RELATIVE_FILE_PATH)),
          });
        } finally {
          handle.close();
        }
      } finally {
        await cleanup();
      }
    },
  );

  it("detects a deleted directory by polling even when no fs event is ever delivered", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const watchedDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await mkdir(watchedDir, { recursive: true });

      // Simulate an OS that never delivers events for this watcher (observed
      // on loaded CI runners): the returned watcher is inert, so only the
      // periodic liveness sweep can notice the deletion.
      fsWatchMock.mockImplementation(
        () =>
          ({
            close: () => {},
            on: () => {},
          }) as unknown as ReturnType<typeof actual.watch>,
      );

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
        await rm(watchedDir, { recursive: true, force: true });
        // The inert watcher emits nothing; the liveness timer must detach and
        // report the disappearance on its own.
        await waitFor(() => changed.includes(watchedDir));
      } finally {
        fsWatchMock.mockImplementation(actual.watch);
        handle.close();
      }
    } finally {
      await cleanup();
    }
  });

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
        // keep the dead watcher forever; the identity comparison must re-arm.
        statSyncMock.mockReturnValue({ ino: 999_999_999n, birthtimeNs: 1n });
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

  it("re-attaches when the recreated directory reuses the watched inode", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const configDir = join(testDir, "packages", "app");
      await mkdir(configDir, { recursive: true });
      const attachStats = actual.statSync(configDir, { bigint: true });

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
        // ext4 hands a freed inode number to the next allocation, so a
        // deleted and recreated directory can present the inode recorded at
        // attach time while the watch is bound to the dead one — the exact
        // state a bare inode comparison cannot see. The creation time still
        // differs, so the liveness sweep must detach and re-arm.
        statSyncMock.mockReturnValue({
          ino: attachStats.ino,
          birthtimeNs: attachStats.birthtimeNs + 1n,
        });
        await waitFor(() => changed.includes(configDir));
      } finally {
        statSyncMock.mockImplementation(actual.statSync);
        handle.close();
      }
    } finally {
      await cleanup();
    }
  });

  it("closes already-started watchers when a later existing target cannot be watched", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const { testDir, cleanup } = await setupTestDirectory();

    try {
      const watchedDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      const failingDir = join(testDir, "failing-directory");
      await mkdir(watchedDir, { recursive: true });
      await mkdir(failingDir, { recursive: true });

      const close = vi.fn();
      fsWatchMock
        .mockImplementationOnce(
          () =>
            ({
              close,
              on: () => {},
            }) as unknown as ReturnType<typeof actual.watch>,
        )
        .mockImplementationOnce(() => {
          throw new Error("Cannot attach watcher");
        });

      expect(() =>
        watchTargets({
          targets: [
            { directory: watchedDir, recursive: true },
            { directory: failingDir, recursive: false },
          ],
          onChange: () => {},
          onError: () => {},
        }),
      ).toThrow();

      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      fsWatchMock.mockImplementation(actual.watch);
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
