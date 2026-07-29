import { type FSWatcher, watch as fsWatch } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

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

  /**
   * Resolves once no run is in flight. Only meant for tests.
   */
  public async waitForIdle(): Promise<void> {
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
 * Starts one `fs.watch` per target and forwards matching events to `onChange`
 * as absolute paths.
 *
 * `fs.watch` reports a `null` filename on some platforms; those events are
 * forwarded as the watched directory itself, which is enough to trigger a
 * regeneration.
 */
export function watchTargets({
  targets,
  onChange,
  onError,
}: {
  targets: readonly WatchTarget[];
  onChange: (params: { path: string }) => void;
  onError: (params: { error: unknown; directory: string }) => void;
}): WatchHandle {
  const watchers: FSWatcher[] = [];

  for (const target of targets) {
    const watcher = fsWatch(
      target.directory,
      { recursive: target.recursive, persistent: true },
      (_eventType, filename) => {
        if (filename === null || filename === undefined) {
          onChange({ path: target.directory });
          return;
        }
        const relativePath = filename.toString();
        if (target.include && !target.include(relativePath)) {
          return;
        }
        onChange({ path: join(target.directory, relativePath) });
      },
    );
    watcher.on("error", (error) => {
      onError({ error, directory: target.directory });
    });
    watchers.push(watcher);
  }

  return {
    close: () => {
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
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
  const configFileNames = new Set([
    basename(configFilePath),
    RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  ]);

  return [
    { directory: join(inputRoot, RULESYNC_RELATIVE_DIR_PATH), recursive: true },
    {
      directory: dirname(configFilePath),
      recursive: false,
      include: (relativePath) => configFileNames.has(relativePath),
    },
  ];
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
