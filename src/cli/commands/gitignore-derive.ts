import type { Feature } from "../../types/features.js";
import { getProcessorRegistryEntry } from "../../types/processor-registry.js";
import type { ToolTarget } from "../../types/tool-targets.js";

export type GitignoreEntryTarget = ToolTarget | "common";

export type GitignoreEntryTag = {
  readonly target: GitignoreEntryTarget | ReadonlyArray<GitignoreEntryTarget>;
  readonly feature: Feature | "general";
  readonly entry: string;
};

// Targets excluded from derivation: they don't generate project files
// (agentsskills), or share their outputs with a non-legacy counterpart and so
// must not produce their own gitignore entries (antigravity → antigravity-ide,
// augmentcode-legacy → augmentcode, claudecode-legacy → claudecode).
const TARGETS_NOT_DERIVED: ReadonlySet<string> = new Set([
  "agentsskills",
  "antigravity",
  "augmentcode-legacy",
  "claudecode-legacy",
]);

// Project-scope outputs that rulesync merges into rather than fully owns
// (user-managed settings files), so they are deliberately not gitignored even
// though a feature emits them.
export const DERIVED_PATHS_NOT_GITIGNORED: ReadonlySet<string> = new Set([
  "**/.amp/settings.json",
  "**/.amp/settings.jsonc",
  "**/.antigravity/settings.json",
  "**/.claude/settings.json",
  "**/.claude/settings.local.json",
  "**/.factory/settings.json",
  "**/.gemini/settings.json",
  "**/.zed/settings.json",
  "**/.warp/settings.toml",
  "**/kilo.json",
  "**/kilo.jsonc",
  "**/opencode.json",
]);

const toPosix = (path: string): string => path.replace(/\\/g, "/");

const dirToGlob = (relativeDirPath: string): string =>
  `**/${toPosix(relativeDirPath).replace(/\/$/, "")}/`;

const fileToGlob = (relativeDirPath: string | undefined, relativeFilePath: string): string => {
  const hasDir = relativeDirPath && relativeDirPath !== ".";
  return `**/${toPosix(hasDir ? `${relativeDirPath}/${relativeFilePath}` : relativeFilePath)}`;
};

const supportsProject = (factory: unknown): boolean => {
  if (typeof factory !== "object" || factory === null || !("meta" in factory)) return true;
  const meta = (factory as { meta?: { supportsProject?: boolean } }).meta;
  return meta?.supportsProject !== false;
};

type SettablePathsFn = (options?: { global?: boolean }) => unknown;

type FactoryMap = ReadonlyMap<ToolTarget, { readonly class: { getSettablePaths: unknown } }>;

const getProjectPaths = (factory: { class: { getSettablePaths: unknown } }): unknown =>
  (factory.class.getSettablePaths as SettablePathsFn)({ global: false });

const pushEntry = (
  entries: GitignoreEntryTag[],
  target: ToolTarget,
  feature: Feature,
  entry: string,
): void => {
  if (DERIVED_PATHS_NOT_GITIGNORED.has(entry)) return;
  entries.push({ target, feature, entry });
};

const deriveDirEntries = (factories: FactoryMap, feature: Feature): GitignoreEntryTag[] => {
  const entries: GitignoreEntryTag[] = [];
  for (const [target, factory] of factories) {
    if (TARGETS_NOT_DERIVED.has(target)) continue;
    if (!supportsProject(factory)) continue;
    const paths = getProjectPaths(factory) as { relativeDirPath?: string };
    const dir = paths.relativeDirPath;
    if (!dir || dir === ".") continue;
    pushEntry(entries, target, feature, dirToGlob(dir));
  }
  return entries;
};

const deriveFileEntries = (factories: FactoryMap, feature: Feature): GitignoreEntryTag[] => {
  const entries: GitignoreEntryTag[] = [];
  for (const [target, factory] of factories) {
    if (TARGETS_NOT_DERIVED.has(target)) continue;
    if (!supportsProject(factory)) continue;
    const paths = getProjectPaths(factory) as {
      relativeDirPath?: string;
      relativeFilePath?: string;
    };
    if (!paths.relativeFilePath) continue;
    pushEntry(entries, target, feature, fileToGlob(paths.relativeDirPath, paths.relativeFilePath));
  }
  return entries;
};

// Rules have a composite shape: root/alternativeRoots are files, nonRoot is a
// directory subtree.
const deriveRulesEntries = (): GitignoreEntryTag[] => {
  const entries: GitignoreEntryTag[] = [];
  const factories = getProcessorRegistryEntry("rules").factory as unknown as FactoryMap;
  for (const [target, factory] of factories) {
    if (TARGETS_NOT_DERIVED.has(target)) continue;
    const paths = getProjectPaths(factory) as {
      root?: { relativeDirPath: string; relativeFilePath: string };
      alternativeRoots?: ReadonlyArray<{ relativeDirPath: string; relativeFilePath: string }>;
      nonRoot?: { relativeDirPath: string } | null;
    };
    for (const root of [paths.root, ...(paths.alternativeRoots ?? [])]) {
      if (root)
        pushEntry(
          entries,
          target,
          "rules",
          fileToGlob(root.relativeDirPath, root.relativeFilePath),
        );
    }
    const nonRootDir = paths.nonRoot?.relativeDirPath;
    if (nonRootDir && nonRootDir !== ".") {
      pushEntry(entries, target, "rules", dirToGlob(nonRootDir));
    }
  }
  return entries;
};

// commands/skills/subagents emit a directory tree; mcp/hooks/permissions/ignore
// emit a single file; rules has a composite root+nonRoot shape.
const DIR_FEATURES = new Set<Feature>(["commands", "skills", "subagents"]);
const FILE_FEATURES = new Set<Feature>(["mcp", "hooks", "permissions", "ignore"]);

export const deriveFeatureGitignoreEntries = (feature: Feature): GitignoreEntryTag[] => {
  if (feature === "rules") return deriveRulesEntries();
  const factory = getProcessorRegistryEntry(feature).factory as unknown as FactoryMap;
  if (DIR_FEATURES.has(feature)) return deriveDirEntries(factory, feature);
  if (FILE_FEATURES.has(feature)) return deriveFileEntries(factory, feature);
  return [];
};

const DERIVED_FEATURES: ReadonlyArray<Feature> = [
  "rules",
  "commands",
  "skills",
  "subagents",
  "mcp",
  "hooks",
  "permissions",
  "ignore",
];

// All gitignore entries rulesync emits, derived from every tool's
// getSettablePaths — the single source of truth for output locations.
export const deriveAllGitignoreEntries = (): GitignoreEntryTag[] =>
  DERIVED_FEATURES.flatMap((feature) => deriveFeatureGitignoreEntries(feature));
