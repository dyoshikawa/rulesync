import { existsSync, type FSWatcher, watch as fsWatch, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";

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
   * When set, only events whose path relative to `directory` satisfies the
   * predicate are forwarded. Used to watch a directory that also holds
   * unrelated files (e.g. the project root, which holds `rulesync.jsonc` next
   * to generated output).
   */
  include?: (relativePath: string) => boolean;
};

export type WatchHandle = {
  close: () => void;
};

/**
 * How often a watcher whose directory disappeared polls for its return.
 */
export const DEFAULT_WATCH_REARM_INTERVAL_MS = 500;

/**
 * Inode of the path, or undefined when it is missing, unreadable, or the
 * platform reports no usable inode (Windows file systems without file IDs
 * report 0). Bigint stats avoid inode truncation on platforms with 64-bit
 * inode numbers.
 */
function statIno(path: string): bigint | undefined {
  try {
    const ino = statSync(path, { bigint: true }).ino;
    return ino === 0n ? undefined : ino;
  } catch {
    return undefined;
  }
}

/**
 * Watches one directory, re-attaching the underlying `fs.watch` if the
 * directory is deleted and later recreated.
 *
 * Without this, a `git checkout` to a branch without `.rulesync/` (or any
 * tool that replaces the directory rather than its contents) would silently
 * kill the watcher: the deleted inode emits no further events and no error,
 * so watch mode would keep running while never regenerating again.
 *
 * The first attach is not guarded — a missing directory at startup is a real
 * configuration error and must surface to the caller.
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
  let watchedIno: bigint | undefined;
  let rearmTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const attach = (): void => {
    // Stat before watching so a delete+recreate between the two calls leaves
    // `watchedIno` on the old inode: the next liveness check then sees a
    // mismatch and self-heals with one extra re-attach. The opposite order
    // would record the new inode for a watcher bound to the dead one,
    // silencing the watch permanently.
    const ino = statIno(target.directory);
    const created = fsWatch(
      target.directory,
      { recursive: target.recursive, persistent: true },
      (_eventType, filename) => {
        // `fs.watch` reports a null filename on some platforms; treat those as
        // a change to the watched directory itself.
        if (filename === null || filename === undefined) {
          onChange({ path: target.directory });
          verifyStillWatching();
          return;
        }
        const relativePath = filename.toString();
        if (target.include && !target.include(relativePath)) {
          // Still check liveness: the final event a deleted directory emits
          // names the directory itself, which every `include` predicate here
          // rejects. Returning early would leave the dead watcher attached
          // and re-arming would never start.
          verifyStillWatching();
          return;
        }
        onChange({ path: join(target.directory, relativePath) });
        verifyStillWatching();
      },
    );
    created.on("error", (error) => {
      onError({ error, directory: target.directory });
      verifyStillWatching();
    });
    watcher = created;
    watchedIno = ino;
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
      // inodes to detect the replacement; an unreadable stat on either side
      // falls back to treating the watcher as alive, matching the previous
      // behavior.
      const currentIno = statIno(target.directory);
      if (currentIno === undefined || watchedIno === undefined || currentIno === watchedIno) {
        return;
      }
    }
    watcher.close();
    watcher = undefined;
    // Report the disappearance the same way an OS delete event would have —
    // liveness may have detected it purely by polling, with no event ever
    // delivered. The scheduler debounces, so an extra notification after an
    // event-driven detection is harmless.
    onChange({ path: target.directory });
    scheduleRearm();
  };

  attach();

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
      watcher?.close();
      watcher = undefined;
    },
  };
}

/**
 * Starts one watcher per target and forwards matching events to `onChange` as
 * absolute paths. If any target fails to attach, the watchers started so far
 * are closed before the error propagates, so no descriptor is leaked.
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

  return { close: closeAll };
}

/**
 * Builds the set of directories watch mode observes: the `.rulesync/` source
 * tree (recursively) and, filtered down to the configuration files themselves,
 * the directory holding `rulesync.jsonc`.
 *
 * Only input paths are watched. Generated output lives outside `.rulesync/`, so
 * a regeneration cannot re-trigger the watcher.
 */
export function buildWatchTargets({
  inputRoot,
  configFilePath,
}: {
  inputRoot: string;
  configFilePath: string;
}): WatchTarget[] {
  const configFilePaths = buildConfigFilePaths({ configFilePath });

  return [
    { directory: join(inputRoot, RULESYNC_RELATIVE_DIR_PATH), recursive: true },
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
 * Renders trigger paths relative to `baseDir` for logging, truncating long
 * bursts so a `git checkout` does not flood the terminal.
 */
export function formatTriggerPaths({
  triggers,
  baseDir,
  max = 5,
}: {
  triggers: readonly string[];
  baseDir: string;
  max?: number;
}): string {
  const displayed = triggers.slice(0, max).map((trigger) => relative(baseDir, trigger) || trigger);
  const remaining = triggers.length - displayed.length;
  return remaining > 0 ? `${displayed.join(", ")} (+${remaining} more)` : displayed.join(", ");
}
