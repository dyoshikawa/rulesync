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

const SHARED_WRITE_FEATURES: ReadonlySet<Feature> = new Set([
  "ignore",
  "mcp",
  "hooks",
  "permissions",
  "rules",
]);

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

const settablePathsForScope = (cls: FactoryClass, global: boolean): SharedWritePath[] => {
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
    return paths;
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
  for (const path of cls.getExtraSharedWritePaths?.({ global }) ?? []) {
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

  for (const entry of PROCESSOR_REGISTRY) {
    if (!SHARED_WRITE_FEATURES.has(entry.feature)) continue;
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
