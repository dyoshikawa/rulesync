import type { Feature } from "../types/features.js";
import { PROCESSOR_REGISTRY } from "../types/processor-registry.js";
import type { ToolTarget } from "../types/tool-targets.js";

export type SharedWritePath = {
  readonly relativeDirPath: string;
  readonly relativeFilePath: string;
};

export type SharedFileWriter = {
  readonly key: string;
  readonly relativeDirPath: string;
  readonly relativeFilePath: string;
  readonly features: ReadonlyArray<Feature>;
  readonly toolsByFeature: ReadonlyMap<Feature, ReadonlyArray<ToolTarget>>;
};

/**
 * The single declaration of the cross-feature write order for shared
 * (read-modify-write) config files: when two features write the same on-disk
 * file, the earlier one writes first and the later one merges on top, so the
 * later feature's conflict policy decides what survives (e.g. `permissions`
 * overriding `ignore`-derived `Read(...)` denies in `.claude/settings.json`).
 * The generation step graph's `dependsOn` edges are derived from this list
 * plus the registry's `getSettablePaths` declarations — adding a tool or a
 * shared path never requires touching the graph by hand.
 */
export const SHARED_WRITE_FEATURE_ORDER = [
  "ignore",
  "subagents",
  "mcp",
  "hooks",
  "permissions",
  "rules",
] as const satisfies readonly Feature[];

/**
 * Features that deliberately never participate in shared read-modify-write
 * config files: each writes its own dedicated per-item artifact, never a file
 * another feature also writes.
 *
 * - `commands`: standalone per-command files (e.g. `.claude/commands/*.md`).
 * - `skills`: standalone per-skill directories (e.g. `.claude/skills/<name>/`).
 *
 * Kept as an explicit list — not an implicit "everything not in
 * {@link SHARED_WRITE_FEATURE_ORDER}" — so that adding a new `Feature` forces a
 * conscious classification: the exhaustiveness test in
 * `shared-file-derive.test.ts` fails until the new feature is placed in either
 * this list or `SHARED_WRITE_FEATURE_ORDER`. That closes the drift where a
 * feature which later starts writing a shared file is silently forgotten.
 */
export const NON_SHARED_WRITE_FEATURES = [
  "commands",
  "skills",
] as const satisfies readonly Feature[];

// Deprecated aliases; a guard for the day one diverges from its canonical
// target's paths. A no-op today since they reuse the canonical class and paths.
const TARGETS_NOT_DERIVED: ReadonlySet<string> = new Set([
  "augmentcode-legacy",
  "claudecode-legacy",
]);

export const sharedFileKey = (path: SharedWritePath): string => {
  const dir = path.relativeDirPath.replace(/\\/g, "/").replace(/\/$/, "");
  const file = path.relativeFilePath.replace(/\\/g, "/");
  return dir === "" || dir === "." ? file : `${dir}/${file}`;
};

type FactoryClass = {
  getSettablePaths?: (options?: { global?: boolean }) => unknown;
  getExtraSharedWritePaths?: (options?: { global?: boolean }) => SharedWritePath[];
};

type FactoryMap = ReadonlyMap<ToolTarget, { readonly class: FactoryClass }>;

export const settablePathsForScope = (cls: FactoryClass, global: boolean): SharedWritePath[] => {
  const paths: SharedWritePath[] = [];
  let settable:
    | {
        relativeDirPath?: string;
        relativeFilePath?: string;
        root?: { relativeDirPath: string; relativeFilePath: string };
        alternativeRoots?: ReadonlyArray<{ relativeDirPath: string; relativeFilePath: string }>;
      }
    | undefined;
  try {
    settable = cls.getSettablePaths?.({ global }) as typeof settable;
  } catch {
    // Fail-open (see the extra-paths note below), but do NOT early-return: the
    // two hooks are independent, so a throwing getSettablePaths must not also
    // suppress this tool's getExtraSharedWritePaths — otherwise a tool whose
    // global getSettablePaths throws while it has a global-only extra shared
    // path would silently drop that path from the write order.
    settable = undefined;
  }
  if (settable?.relativeFilePath) {
    paths.push({
      relativeDirPath: settable.relativeDirPath ?? ".",
      relativeFilePath: settable.relativeFilePath,
    });
  }
  if (settable?.root) {
    paths.push(settable.root);
    for (const alt of settable.alternativeRoots ?? []) paths.push(alt);
  }
  // Deliberately fail-open here, mirroring the getSettablePaths() catch above:
  // this derivation runs at module load (SHARED_WRITE_STEPS in generate.ts), so
  // a throwing tool implementation must not take down every generate. The
  // trade-off is that a broken getExtraSharedWritePaths silently drops that
  // tool's extra shared paths from the write order — acceptable because every
  // current implementation returns a static constant that cannot throw.
  let extra: SharedWritePath[] = [];
  try {
    extra = cls.getExtraSharedWritePaths?.({ global }) ?? [];
  } catch {
    extra = [];
  }
  for (const path of extra) {
    if (path.relativeFilePath) paths.push(path);
  }
  return paths;
};

// A shared file may live at a different path per scope (e.g. `opencode.json` vs
// `.config/opencode/opencode.json`), so a feature's writes are the union across
// both scopes; the step graph declares that union.
const collectFactoryPaths = (factory: { class: FactoryClass }): SharedWritePath[] => [
  ...settablePathsForScope(factory.class, false),
  ...settablePathsForScope(factory.class, true),
];

/**
 * Derive, from the processor registry, every on-disk file that two or more
 * features read-modify-write. Source of truth the generation step graph's
 * `writesSharedFile` declarations must match.
 */
export const deriveSharedFileWriters = (): SharedFileWriter[] => {
  const byKey = new Map<string, Map<Feature, Set<ToolTarget>>>();
  const pathByKey = new Map<string, SharedWritePath>();

  // Consider every feature, not just those already in SHARED_WRITE_FEATURE_ORDER:
  // a feature that starts returning a shared path (2+ writers of the same file)
  // must surface here so deriveSharedWriteSteps can reject it for lacking an
  // explicit precedence position, instead of being silently dropped from the
  // write order. Files a single feature writes are excluded below (features < 2).
  for (const entry of PROCESSOR_REGISTRY) {
    const factories = entry.factory as unknown as FactoryMap;
    for (const [tool, factory] of factories) {
      if (TARGETS_NOT_DERIVED.has(tool)) continue;
      for (const path of collectFactoryPaths(factory)) {
        const key = sharedFileKey(path);
        if (!pathByKey.has(key)) pathByKey.set(key, path);
        let features = byKey.get(key);
        if (!features) {
          features = new Map();
          byKey.set(key, features);
        }
        let tools = features.get(entry.feature);
        if (!tools) {
          tools = new Set();
          features.set(entry.feature, tools);
        }
        tools.add(tool);
      }
    }
  }

  const writers: SharedFileWriter[] = [];
  for (const [key, features] of byKey) {
    if (features.size < 2) continue;
    const path = pathByKey.get(key)!;
    const toolsByFeature = new Map<Feature, ReadonlyArray<ToolTarget>>();
    for (const [feature, tools] of features) {
      toolsByFeature.set(feature, [...tools].toSorted());
    }
    writers.push({
      key,
      relativeDirPath: path.relativeDirPath,
      relativeFilePath: path.relativeFilePath,
      features: [...features.keys()].toSorted(),
      toolsByFeature,
    });
  }

  return writers.toSorted((a, b) => a.key.localeCompare(b.key));
};

export type SharedWriteStep = {
  readonly writesSharedFile: readonly string[];
  readonly dependsOn: readonly Feature[];
};

/**
 * Derive, per shared-write feature, the shared files it writes and the
 * `dependsOn` edges that fix a safe write order: for every shared file, each
 * writer depends on all writers that precede it in
 * {@link SHARED_WRITE_FEATURE_ORDER}. This is the source the generation step
 * graph consumes, so registry changes (a new tool, a new settable path)
 * propagate into the execution order without a hand-maintained declaration.
 *
 * @throws Error if a feature writes a shared file but has no position in
 *   `SHARED_WRITE_FEATURE_ORDER` — ordering it is a deliberate decision about
 *   whose merge policy wins, so it must be made explicitly there.
 */
export const deriveSharedWriteSteps = (): ReadonlyMap<Feature, SharedWriteStep> => {
  const orderIndex = new Map<Feature, number>(
    SHARED_WRITE_FEATURE_ORDER.map((feature, index) => [feature, index]),
  );
  const filesByFeature = new Map<Feature, Set<string>>();
  const depsByFeature = new Map<Feature, Set<Feature>>();

  for (const writer of deriveSharedFileWriters()) {
    for (const feature of writer.features) {
      if (!orderIndex.has(feature)) {
        throw new Error(
          `Feature '${feature}' writes the shared file '${writer.key}' but has no position ` +
            `in SHARED_WRITE_FEATURE_ORDER. Decide where its writes merge relative to the ` +
            `other features and add it to the order.`,
        );
      }
    }
    const ordered = [...writer.features].toSorted(
      (a, b) => orderIndex.get(a)! - orderIndex.get(b)!,
    );
    for (const [position, feature] of ordered.entries()) {
      let files = filesByFeature.get(feature);
      if (!files) {
        files = new Set();
        filesByFeature.set(feature, files);
      }
      files.add(writer.key);
      let deps = depsByFeature.get(feature);
      if (!deps) {
        deps = new Set();
        depsByFeature.set(feature, deps);
      }
      for (const earlier of ordered.slice(0, position)) {
        deps.add(earlier);
      }
    }
  }

  const steps = new Map<Feature, SharedWriteStep>();
  for (const [feature, files] of filesByFeature) {
    steps.set(feature, {
      writesSharedFile: [...files].toSorted(),
      dependsOn: [...(depsByFeature.get(feature) ?? [])].toSorted(
        (a, b) => orderIndex.get(a)! - orderIndex.get(b)!,
      ),
    });
  }
  return steps;
};
