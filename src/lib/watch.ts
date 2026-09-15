import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { type FSWatcher, watch } from "chokidar";

import {
  FEATURE_SOURCE_TREE_ENTRIES,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import { stripControlCharacters } from "../utils/control-characters.js";

/**
 * Trailing debounce window applied to file-system events before a regeneration
 * is started. Editor save storms and `git checkout` emit many events within a
 * few milliseconds; coalescing them into a single run keeps the terminal
 * readable and avoids redundant work.
 */
export const DEFAULT_WATCH_DEBOUNCE_MS = 300;

export type WatchSchedulerParams = {
  /**
   * Runs one regeneration for the paths that changed since the previous run.
   */
  run: (params: { triggers: string[] }) => Promise<void>;
  /**
   * Called when `run` rejects. Watching continues afterwards, so this must not
   * rethrow.
   */
  onError: (params: { error: unknown; triggers: string[] }) => void;
  debounceMs?: number;
};

/**
 * Coalesces file-system change notifications into debounced, non-overlapping
 * runs.
 *
 * Guarantees:
 * - At most one `run` is in flight at any time.
 * - Every notified path is reported to exactly one `run` as a trigger.
 * - Notifications that arrive while a run is in flight schedule exactly one
 *   follow-up run after it finishes, so a change is never lost and never
 *   causes a run per event.
 */
export class WatchScheduler {
  private readonly run: (params: { triggers: string[] }) => Promise<void>;
  private readonly onError: (params: { error: unknown; triggers: string[] }) => void;
  private readonly debounceMs: number;
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private closed = false;

  constructor({ run, onError, debounceMs = DEFAULT_WATCH_DEBOUNCE_MS }: WatchSchedulerParams) {
    this.run = run;
    this.onError = onError;
    this.debounceMs = debounceMs;
  }

  public notify({ path }: { path: string }): void {
    if (this.closed) {
      return;
    }
    this.pending.add(path);
    this.schedule();
  }

  /**
   * Stops accepting notifications and waits for an in-flight run to settle.
   * Pending (not yet started) changes are dropped.
   */
  public async close(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    this.pending.clear();
    await this.running;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    // A run started by an earlier flush re-schedules itself when it finds
    // pending triggers, so bailing out here never drops a change.
    if (this.closed || this.running !== undefined || this.pending.size === 0) {
      return;
    }

    const triggers = [...this.pending];
    this.pending.clear();

    const running = (async () => {
      try {
        await this.run({ triggers });
      } catch (error) {
        this.onError({ error, triggers });
      }
    })();
    this.running = running;
    await running;
    this.running = undefined;

    if (!this.closed && this.pending.size > 0) {
      this.schedule();
    }
  }
}

export type WatchTarget = {
  /** Absolute path of the directory to watch. */
  directory: string;
  recursive: boolean;
  /**
   * When set, only paths relative to `directory` that satisfy the predicate
   * are watched; a rejected directory prunes its whole subtree. Used to watch
   * a directory that also holds unrelated files (e.g. the project root, which
   * holds `rulesync.jsonc` next to generated output).
   */
  include?: (relativePath: string) => boolean;
};

export type WatchHandle = {
  close: () => void;
  /**
   * Resolves once every target that exists is being watched. Changes made
   * before then may go unreported.
   */
  ready: Promise<void>;
};

/**
 * How often a watcher whose directory disappeared polls for its return.
 */
export const DEFAULT_WATCH_REARM_INTERVAL_MS = 500;

/**
 * Identity of the directory behind the path, or undefined when it is missing,
 * unreadable, or the platform reports no usable inode (Windows file systems
 * without file IDs report 0). Bigint stats avoid inode truncation on
 * platforms with 64-bit inode numbers.
 *
 * The inode alone is not a reliable identity: ext4 hands a freed inode number
 * to the next allocation in the same block group, so a deleted and quickly
 * recreated directory can present the watcher's recorded inode while the
 * watch is bound to the dead one. Creation time separates the two
 * generations; file systems that do not report it (birthtime of 0) fall back
 * to the inode alone.
 */
function statIdentity(path: string): string | undefined {
  try {
    const stats = statSync(path, { bigint: true });
    if (stats.ino === 0n) {
      return undefined;
    }
    return stats.birthtimeNs ? `${stats.ino}:${stats.birthtimeNs}` : `${stats.ino}`;
  } catch {
    return undefined;
  }
}

/**
 * Watches one directory, re-attaching the underlying watcher if the
 * directory is deleted and later recreated.
 *
 * Without this, a `git checkout` to a branch without `.rulesync/` (or any
 * tool that replaces the directory rather than its contents) would silently
 * kill the watcher: the deleted inode emits no further events and no error,
 * so watch mode would keep running while never regenerating again.
 *
 * Missing targets start in re-arm mode. The shared input-root preflight has
 * already required the primary root, while optional overlay roots may be
 * created after watch mode starts.
 */
function watchTargetWithRearm({
  target,
  onChange,
  onError,
  rearmIntervalMs,
}: {
  target: WatchTarget;
  onChange: (params: { path: string }) => void;
  onError: (params: { error: unknown; directory: string }) => void;
  rearmIntervalMs: number;
}): WatchHandle {
  let watcher: FSWatcher | undefined;
  let watchedIdentity: string | undefined;
  let rearmTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const { promise: ready, resolve: markReady } = Promise.withResolvers<void>();

  const attach = (): void => {
    // Stat before watching so a delete+recreate between the two calls leaves
    // `watchedIdentity` on the old directory: the next liveness check then
    // sees a mismatch and self-heals with one extra re-attach. The opposite
    // order would record the new identity for a watcher bound to the dead
    // one, silencing the watch permanently.
    const identity = statIdentity(target.directory);
    const { include } = target;
    const created = watch(target.directory, {
      ignoreInitial: true,
      depth: target.recursive ? undefined : 0,
      // chokidar also asks about the watched directory itself, which every
      // `include` predicate here rejects.
      ignored:
        include &&
        ((path: string) => {
          const relativePath = relative(target.directory, path);
          return relativePath !== "" && !include(relativePath);
        }),
    });
    created.on("all", (_event, path) => {
      onChange({ path });
      verifyStillWatching();
    });
    created.on("error", (error) => {
      onError({ error, directory: target.directory });
      verifyStillWatching();
    });
    created.once("ready", markReady);
    watcher = created;
    watchedIdentity = identity;
  };

  const scheduleRearm = (): void => {
    if (closed || rearmTimer !== undefined) {
      return;
    }
    rearmTimer = setInterval(() => {
      if (closed || !existsSync(target.directory)) {
        return;
      }
      clearInterval(rearmTimer);
      rearmTimer = undefined;
      try {
        attach();
      } catch (error) {
        // Lost another race with a delete; keep polling.
        onError({ error, directory: target.directory });
        scheduleRearm();
        return;
      }
      // The directory came back with unknown contents, so regenerate.
      onChange({ path: target.directory });
    }, rearmIntervalMs);
  };

  const verifyStillWatching = (): void => {
    if (closed || watcher === undefined) {
      return;
    }
    if (existsSync(target.directory)) {
      // A bare existence check is not enough: when the directory is deleted
      // and recreated before the delete event is delivered (fast branch
      // switches, slow CI event queues), the path exists again but the watch
      // is still bound to the dead inode and would never fire again. Compare
      // identities (inode plus creation time) to detect the replacement; an
      // unreadable stat on either side falls back to treating the watcher as
      // alive, matching the previous behavior.
      const currentIdentity = statIdentity(target.directory);
      if (
        currentIdentity === undefined ||
        watchedIdentity === undefined ||
        currentIdentity === watchedIdentity
      ) {
        return;
      }
    }
    void watcher.close();
    watcher = undefined;
    // Report the disappearance the same way an OS delete event would have —
    // liveness may have detected it purely by polling, with no event ever
    // delivered. The scheduler debounces, so an extra notification after an
    // event-driven detection is harmless.
    onChange({ path: target.directory });
    scheduleRearm();
  };

  if (existsSync(target.directory)) {
    try {
      attach();
    } catch (error) {
      // If the directory disappeared between the existence check and the
      // watcher's start, treat it like any other temporarily absent overlay.
      // Permission and platform errors for a still-existing directory remain
      // real attachment failures and must propagate.
      if (existsSync(target.directory)) {
        throw error;
      }

      markReady();
      scheduleRearm();
    }
  } else {
    markReady();
    scheduleRearm();
  }

  // Event-driven liveness checks alone are not enough: OS event delivery for
  // a deleted watched directory can be arbitrarily late or dropped entirely
  // (observed on loaded CI runners), leaving a dead watcher attached forever.
  // A periodic sweep runs the same inode-based check on a timer, so a
  // replaced or removed directory is detected within `rearmIntervalMs` even
  // when no event ever arrives. `unref()` keeps the interval from holding the
  // process open on its own.
  const livenessTimer = setInterval(() => {
    verifyStillWatching();
  }, rearmIntervalMs);
  livenessTimer.unref?.();

  return {
    close: () => {
      closed = true;
      clearInterval(livenessTimer);
      if (rearmTimer !== undefined) {
        clearInterval(rearmTimer);
        rearmTimer = undefined;
      }
      void watcher?.close();
      watcher = undefined;
    },
    ready,
  };
}

/**
 * Starts one watcher per target and forwards matching events to `onChange` as
 * absolute paths. Missing targets are polled until they appear. If any
 * existing target fails to attach, the watchers started so far are closed
 * before the error propagates, so no descriptor is leaked.
 */
export function watchTargets({
  targets,
  onChange,
  onError,
  rearmIntervalMs = DEFAULT_WATCH_REARM_INTERVAL_MS,
}: {
  targets: readonly WatchTarget[];
  onChange: (params: { path: string }) => void;
  onError: (params: { error: unknown; directory: string }) => void;
  rearmIntervalMs?: number;
}): WatchHandle {
  const handles: WatchHandle[] = [];

  const closeAll = (): void => {
    for (const handle of handles) {
      handle.close();
    }
  };

  try {
    for (const target of targets) {
      handles.push(watchTargetWithRearm({ target, onChange, onError, rearmIntervalMs }));
    }
  } catch (error) {
    closeAll();
    throw error;
  }

  return {
    close: closeAll,
    ready: Promise.all(handles.map((handle) => handle.ready)).then(() => undefined),
  };
}

const SOURCE_TREE_ENTRY_NAMES: ReadonlySet<string> = new Set(
  Object.values(FEATURE_SOURCE_TREE_ENTRIES).flat(),
);

/**
 * Builds the set of directories watch mode observes: each input root's
 * source tree (recursively) and, filtered down to the configuration files
 * themselves, the directory holding `rulesync.jsonc`.
 *
 * Each `inputRoots[i]` is the rulesync source tree itself (e.g.
 * `/repo/.rulesync` or `/repo/.rulesync.local`), so watch attaches
 * directly to it — no implicit `.rulesync/` join. Only input paths are
 * watched; generated output lives outside every source tree, so a
 * regeneration cannot re-trigger the watcher. Duplicate roots (after
 * resolution) are deduped so the same directory is never watched twice.
 * Within a root, only the top-level entries `generate` reads are watched,
 * so churn in unrelated siblings (e.g. `.git/` when the root is the project
 * directory) does not trigger a regeneration.
 */
export function buildWatchTargets({
  inputRoots,
  configFilePath,
}: {
  inputRoots: readonly string[];
  configFilePath: string;
}): WatchTarget[] {
  const configFilePaths = buildConfigFilePaths({ configFilePath });

  const seen = new Set<string>();
  const rulesyncTargets: WatchTarget[] = [];

  for (const root of inputRoots) {
    if (seen.has(root)) continue;

    seen.add(root);
    rulesyncTargets.push({
      directory: root,
      recursive: true,
      include: (relativePath) =>
        SOURCE_TREE_ENTRY_NAMES.has(relativePath.split(sep)[0] ?? relativePath),
    });
  }

  return [
    ...rulesyncTargets,
    {
      directory: dirname(configFilePath),
      recursive: false,
      include: (relativePath) => configFilePaths.has(join(dirname(configFilePath), relativePath)),
    },
  ];
}

/**
 * The absolute paths of the configuration files watch mode observes: the base
 * configuration file and the `rulesync.local.jsonc` sitting next to it, which
 * is exactly what `ConfigResolver` loads.
 */
export function buildConfigFilePaths({ configFilePath }: { configFilePath: string }): Set<string> {
  return new Set([
    configFilePath,
    join(dirname(configFilePath), RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH),
  ]);
}

/**
 * Renders trigger paths for logging, choosing the base directory per trigger.
 *
 * Each trigger is displayed relative to the input root that actually contains
 * it (matched by longest-prefix, so nested roots pick the deepest one). A
 * trigger that falls outside every root — the configuration file, or any
 * path a caller passes explicitly — is displayed absolute, which is what
 * users expect from the "configuration file changed" message. Long bursts
 * are truncated so a `git checkout` does not flood the terminal.
 *
 * Trigger paths come from filesystem watch events, so a repository whose
 * working tree holds a maliciously named file could embed control characters
 * (e.g. ANSI escapes or bidirectional overrides) in what becomes a single
 * terminal line; each displayed path is sanitized before joining.
 */
export function formatTriggerPaths({
  triggers,
  inputRoots,
  max = 5,
}: {
  triggers: readonly string[];
  inputRoots: readonly string[];
  max?: number;
}): string {
  // Longest-prefix wins so a trigger under `/a/b` is rendered relative to
  // `/a/b`, not to a sibling `/a`. Ties by length preserve input order.
  const rootsByPrecedence = [...inputRoots].toSorted((a, b) => b.length - a.length);

  const displayed = triggers.slice(0, max).map((trigger) => {
    for (const root of rootsByPrecedence) {
      const rel = relative(root, trigger);

      // `rel` is empty when trigger === root, is exactly `..` or starts with a
      // `..` path segment when trigger is outside root, or is absolute on
      // Windows when the two live on different drives — none of those count as
      // "under" root. The segment check matters because a legitimate child
      // named `..foo` also starts with the two characters `..`.
      if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        continue;
      }

      return stripControlCharacters(rel);
    }

    return stripControlCharacters(trigger);
  });

  const remaining = triggers.length - displayed.length;

  return remaining > 0 ? `${displayed.join(", ")} (+${remaining} more)` : displayed.join(", ");
}
