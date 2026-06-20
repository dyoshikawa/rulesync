import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolCommandFactories } from "../../features/commands/commands-processor.js";
import { toolHooksFactories } from "../../features/hooks/hooks-processor.js";
import { toolIgnoreFactories } from "../../features/ignore/ignore-processor.js";
import { toolMcpFactories } from "../../features/mcp/mcp-processor.js";
import { toolPermissionsFactories } from "../../features/permissions/permissions-processor.js";
import { toolRuleFactories } from "../../features/rules/rules-processor.js";
import { toolSkillFactories } from "../../features/skills/skills-processor.js";
import { toolSubagentFactories } from "../../features/subagents/subagents-processor.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { ALL_TOOL_TARGETS } from "../../types/tool-targets.js";
import { toPosixPath } from "../../utils/file.js";
import {
  ALL_GITIGNORE_ENTRIES,
  GITIGNORE_ENTRY_REGISTRY,
  filterGitignoreEntries,
} from "./gitignore-entries.js";

const logger = createMockLogger();

// These targets intentionally have no gitignore entries because they either
// don't generate files (e.g., agentsskills), share paths with their
// non-legacy counterparts (e.g., augmentcode-legacy → augmentcode), or write
// only into a user-owned shared settings file that rulesync must not gitignore.
// Note: `amp` now has a `skills` entry (`.agents/skills/`); its MCP output still
// lands in the user-owned `.amp/settings.{json,jsonc}`, which is not gitignored.
const TARGETS_WITHOUT_GITIGNORE_ENTRIES = new Set([
  "agentsskills",
  "antigravity",
  "augmentcode-legacy",
  "claudecode-legacy",
]);

describe("GITIGNORE_ENTRY_REGISTRY", () => {
  it("should have no duplicate entries within a single feature tag", () => {
    // The registry intentionally allows the SAME entry to be registered under
    // different feature tags. The `resolveGitignoreEntries` writer dedupes the
    // final output. What we want to forbid is the same (target, feature, entry)
    // triple appearing twice.
    const seen = new Set<string>();
    const collisions: string[] = [];
    for (const tag of GITIGNORE_ENTRY_REGISTRY) {
      const targets = Array.isArray(tag.target) ? tag.target : [tag.target];
      for (const target of targets) {
        const key = `${target}::${tag.feature}::${tag.entry}`;
        if (seen.has(key)) {
          collisions.push(key);
        }
        seen.add(key);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("should cover all tool targets except intentionally excluded ones", () => {
    const registeredTargets = new Set(
      GITIGNORE_ENTRY_REGISTRY.flatMap((tag) =>
        Array.isArray(tag.target) ? tag.target : [tag.target],
      ),
    );
    for (const target of ALL_TOOL_TARGETS) {
      if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) {
        expect(registeredTargets).not.toContain(target);
      } else {
        expect(registeredTargets).toContain(target);
      }
    }
  });
});

// Project-scope outputs that are intentionally NOT gitignored because they are
// user-managed settings files that rulesync merges into (and round-trips),
// rather than fully-owned generated artifacts.
const DERIVED_PATHS_NOT_GITIGNORED = new Set([
  "**/.amp/settings.json",
  "**/.amp/settings.jsonc",
  "**/.antigravity/settings.json",
  "**/.claude/settings.json",
  "**/.factory/settings.json",
  "**/.gemini/settings.json",
  "**/.zed/settings.json",
  "**/.warp/settings.toml",
  "**/kilo.json",
  "**/kilo.jsonc",
  "**/opencode.json",
]);

const dirToGlob = (relativeDirPath: string): string =>
  `**/${toPosixPath(relativeDirPath).replace(/\/$/, "")}/`;

const fileToGlob = (relativeDirPath: string | undefined, relativeFilePath: string): string => {
  const hasDir = relativeDirPath && relativeDirPath !== ".";
  return `**/${toPosixPath(hasDir ? `${relativeDirPath}/${relativeFilePath}` : relativeFilePath)}`;
};

const stripTrailingSlash = (glob: string): string => glob.replace(/\/$/, "");

// Registry entries that deliberately gitignore a whole tool subtree, so a deeper
// output dir is covered without its own entry. Directories outside these must
// match EXACTLY, so a rename like `.augment/commands/` → `.augment/cmds/` fails
// instead of silently matching a broader parent.
const SUBTREE_COVERAGE_DIRS = ["**/.cursor", "**/.agents", "**/.goose", "**/.rovodev/.rulesync"];

const isCoveredDir = (dirGlob: string): boolean => {
  const normalized = stripTrailingSlash(dirGlob);
  if (SUBTREE_COVERAGE_DIRS.some((root) => normalized.startsWith(`${root}/`))) return true;
  return GITIGNORE_ENTRY_REGISTRY.some((tag) => stripTrailingSlash(tag.entry) === normalized);
};

// A file output may match an entry exactly, or fall under a registered directory
// entry (trailing slash) that gitignores its whole subtree.
const isCoveredFile = (fileGlob: string): boolean => {
  const normalized = stripTrailingSlash(fileGlob);
  return GITIGNORE_ENTRY_REGISTRY.some((tag) => {
    if (tag.entry === normalized) return true;
    if (!tag.entry.endsWith("/")) return false;
    return normalized.startsWith(stripTrailingSlash(tag.entry) + "/");
  });
};

describe("getSettablePaths coverage", () => {
  // Guards against the implicit coupling between each tool's getSettablePaths
  // (the source of truth for output locations) and the hand-written registry:
  // every project-scope output must be gitignored, or explicitly excepted.
  const dirFeatures = [
    ["commands", toolCommandFactories],
    ["skills", toolSkillFactories],
    ["subagents", toolSubagentFactories],
  ] as const;

  for (const [feature, factories] of dirFeatures) {
    for (const [target, factory] of factories) {
      if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) continue;
      // Skip global-only tools explicitly (same guard as the fileFeatures branch
      // below) rather than relying on `getSettablePaths({ global: false })`
      // throwing and a broad catch swallowing it — otherwise a global-only tool
      // refactored to return a project path would silently change coverage.
      const meta = factory.meta as { supportsProject?: boolean } | undefined;
      if (meta && meta.supportsProject === false) continue;
      it(`covers ${feature} output for ${target}`, () => {
        // No try/catch: a project-supporting tool must resolve a project path
        // without throwing, so an unexpected throw fails the test instead of
        // passing silently.
        const paths = factory.class.getSettablePaths({ global: false });
        const dir = paths.relativeDirPath;
        if (!dir || dir === ".") return;
        const glob = dirToGlob(dir);
        if (DERIVED_PATHS_NOT_GITIGNORED.has(glob.replace(/\/$/, ""))) return;
        expect(isCoveredDir(glob)).toBe(true);
      });
    }
  }

  const fileFeatures = [
    ["mcp", toolMcpFactories],
    ["hooks", toolHooksFactories],
    ["permissions", toolPermissionsFactories],
    // `ignore` outputs a single file per tool (e.g. `.augmentignore`), fitting the
    // file-feature shape.
    ["ignore", toolIgnoreFactories],
  ] as const;

  for (const [feature, factories] of fileFeatures) {
    for (const [target, factory] of factories) {
      if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) continue;
      // `ToolIgnoreFactory` has no `meta`; guard the lookup so the union stays type-safe.
      const meta =
        "meta" in factory ? (factory.meta as { supportsProject?: boolean } | undefined) : undefined;
      if (meta && meta.supportsProject === false) continue;
      it(`covers ${feature} output for ${target}`, () => {
        // No try/catch: project-supporting tools must resolve without throwing
        // (global-only tools are already skipped above), so an unexpected throw
        // fails the test instead of passing silently.
        const paths: { relativeDirPath?: string; relativeFilePath?: string } =
          factory.class.getSettablePaths({ global: false });
        if (!paths.relativeFilePath) return;
        const glob = fileToGlob(paths.relativeDirPath, paths.relativeFilePath);
        if (DERIVED_PATHS_NOT_GITIGNORED.has(glob)) return;
        expect(isCoveredFile(glob)).toBe(true);
      });
    }
  }

  // `rules` has a composite shape ({ root, alternativeRoots, nonRoot }); roots are
  // files, nonRoot is a directory. No supportsProject guard: rules are universally
  // project-scoped, so getSettablePaths({ global: false }) never throws here.
  for (const [target, factory] of toolRuleFactories) {
    if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) continue;
    it(`covers rules output for ${target}`, () => {
      const paths = factory.class.getSettablePaths({ global: false });
      const rootFiles = [paths.root, ...(paths.alternativeRoots ?? [])].filter(
        (entry): entry is { relativeDirPath: string; relativeFilePath: string } =>
          entry !== undefined,
      );
      for (const root of rootFiles) {
        const glob = fileToGlob(root.relativeDirPath, root.relativeFilePath);
        if (DERIVED_PATHS_NOT_GITIGNORED.has(glob)) continue;
        expect(isCoveredFile(glob), `root ${glob}`).toBe(true);
      }
      const nonRootDir = paths.nonRoot?.relativeDirPath;
      if (nonRootDir && nonRootDir !== ".") {
        const glob = dirToGlob(nonRootDir);
        if (!DERIVED_PATHS_NOT_GITIGNORED.has(glob.replace(/\/$/, ""))) {
          expect(isCoveredDir(glob), `nonRoot ${glob}`).toBe(true);
        }
      }
    });
  }
});

describe("registry reverse coverage", () => {
  // Every project-scope output glob some tool actually emits — the inverse of the
  // coverage check, used to detect ghost entries no tool writes anymore.
  const collectEmittedGlobs = (): Set<string> => {
    const globs = new Set<string>();
    const dirFactories = [toolCommandFactories, toolSkillFactories, toolSubagentFactories];
    const fileFactories = [
      toolMcpFactories,
      toolHooksFactories,
      toolPermissionsFactories,
      toolIgnoreFactories,
    ];
    for (const factories of dirFactories) {
      for (const [target, factory] of factories) {
        if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) continue;
        const meta =
          "meta" in factory
            ? (factory.meta as { supportsProject?: boolean } | undefined)
            : undefined;
        if (meta && meta.supportsProject === false) continue;
        const dir = factory.class.getSettablePaths({ global: false }).relativeDirPath;
        if (dir && dir !== ".") globs.add(stripTrailingSlash(dirToGlob(dir)));
      }
    }
    for (const factories of fileFactories) {
      for (const [target, factory] of factories) {
        if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) continue;
        const meta =
          "meta" in factory
            ? (factory.meta as { supportsProject?: boolean } | undefined)
            : undefined;
        if (meta && meta.supportsProject === false) continue;
        const paths: { relativeDirPath?: string; relativeFilePath?: string } =
          factory.class.getSettablePaths({ global: false });
        if (paths.relativeFilePath)
          globs.add(fileToGlob(paths.relativeDirPath, paths.relativeFilePath));
      }
    }
    for (const [target, factory] of toolRuleFactories) {
      if (TARGETS_WITHOUT_GITIGNORE_ENTRIES.has(target)) continue;
      const paths = factory.class.getSettablePaths({ global: false });
      for (const root of [paths.root, ...(paths.alternativeRoots ?? [])]) {
        if (root) globs.add(fileToGlob(root.relativeDirPath, root.relativeFilePath));
      }
      const nonRootDir = paths.nonRoot?.relativeDirPath;
      if (nonRootDir && nonRootDir !== ".") globs.add(stripTrailingSlash(dirToGlob(nonRootDir)));
    }
    return globs;
  };

  // Real entries the reverse check can't match to a `{ global: false }` output.
  const REVERSE_COVERAGE_EXCEPTIONS = new Set([
    // Aggregate subtree roots and shared trees re-tagged per target.
    ...SUBTREE_COVERAGE_DIRS,
    "**/AGENTS.md",
    "**/.agents/skills",
    // Global-scope-only outputs (emitted under the home dir).
    "**/.copilot/agents",
    "**/.copilot/hooks",
    "**/.copilot/mcp-config.json",
    "**/.codeium/windsurf/skills",
    // supportsProject:false, so the project-scope collector skips it.
    "**/.deepagents/hooks.json",
    // Outputs not produced via getSettablePaths (single-file or local/legacy rules).
    "**/.roomodes",
    "**/.codexignore",
    "**/.augment-guidelines",
    "**/CLAUDE.local.md",
    "**/.claude/CLAUDE.local.md",
  ]);

  it("has no ghost entries — every non-general entry maps to an emitted output", () => {
    const emitted = collectEmittedGlobs();
    const ghosts: string[] = [];
    for (const tag of GITIGNORE_ENTRY_REGISTRY) {
      if (tag.feature === "general") continue;
      const targets = Array.isArray(tag.target) ? tag.target : [tag.target];
      if (targets.includes("common")) continue;
      const normalized = stripTrailingSlash(tag.entry);
      if (REVERSE_COVERAGE_EXCEPTIONS.has(normalized)) continue;
      const matched = [...emitted].some(
        (glob) => glob === normalized || glob.startsWith(`${normalized}/`),
      );
      if (!matched) ghosts.push(`${tag.entry} (${targets.join(",")}/${tag.feature})`);
    }
    expect(ghosts).toEqual([]);
  });

  it("subtree-coverage roots exist as directory entries in the registry", () => {
    // Guard that each prefix-coverage root is itself a registered directory entry,
    // so removing the root surfaces here instead of silently widening coverage.
    const dirEntries = new Set(
      GITIGNORE_ENTRY_REGISTRY.filter((tag) => tag.entry.endsWith("/")).map((tag) =>
        stripTrailingSlash(tag.entry),
      ),
    );
    for (const root of SUBTREE_COVERAGE_DIRS) {
      expect(dirEntries, `missing subtree root ${root}`).toContain(root);
    }
  });
});

describe("ALL_GITIGNORE_ENTRIES", () => {
  it("should contain every distinct entry from the registry", () => {
    // The registry can register the same entry under multiple feature tags;
    // `ALL_GITIGNORE_ENTRIES` is the deduplicated view, so its length matches
    // the unique entry count rather than the raw registry length.
    const distinctRegistryEntries = new Set(GITIGNORE_ENTRY_REGISTRY.map((tag) => tag.entry));
    expect(ALL_GITIGNORE_ENTRIES.length).toBe(distinctRegistryEntries.size);
    for (const tag of GITIGNORE_ENTRY_REGISTRY) {
      expect(ALL_GITIGNORE_ENTRIES).toContain(tag.entry);
    }
  });
});

describe("filterGitignoreEntries", () => {
  it("should return all entries when no filters are specified", () => {
    const result = filterGitignoreEntries();
    expect(result).toEqual([...ALL_GITIGNORE_ENTRIES]);
  });

  it("should return all entries when empty params are passed", () => {
    const result = filterGitignoreEntries({});
    expect(result).toEqual([...ALL_GITIGNORE_ENTRIES]);
  });

  describe("target filtering", () => {
    it("should return only matching target entries plus common entries", () => {
      const result = filterGitignoreEntries({ logger, targets: ["claudecode"] });

      // Should include common entries
      expect(result).toContain(".rulesync/skills/.curated/");
      expect(result).toContain(".rulesync/rules/*.local.md");

      // Should include claudecode entries
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/rules/");
      expect(result).toContain("**/.claude/commands/");
      expect(result).toContain("**/.mcp.json");

      // Should NOT include other target entries
      expect(result).not.toContain("**/.cursor/");
      expect(result).not.toContain("**/.clinerules/");
      expect(result).not.toContain("**/.github/instructions/");
    });

    it("should support multiple targets", () => {
      const result = filterGitignoreEntries({ logger, targets: ["claudecode", "copilot"] });

      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.github/instructions/");
      expect(result).not.toContain("**/.cursor/");
    });

    it("should include shared copilot rule entries for copilotcli target", () => {
      const result = filterGitignoreEntries({ logger, targets: ["copilotcli"] });

      expect(result).toContain("**/.github/copilot-instructions.md");
      expect(result).toContain("**/.github/instructions/");
      expect(result).toContain("**/.copilot/mcp-config.json");
      expect(result).not.toContain("**/.github/prompts/");
    });

    it("should include the root AGENTS.md and .agents/rules entries for antigravity-ide", () => {
      const result = filterGitignoreEntries({ logger, targets: ["antigravity-ide"] });

      // antigravity-ide emits the root rule as a project-root AGENTS.md plus
      // non-root rules under .agents/rules/.
      expect(result).toContain("**/AGENTS.md");
      expect(result).toContain("**/.agents/rules/");
      // GEMINI.md (a geminicli-only entry) must NOT be included for this target.
      expect(result).not.toContain("**/GEMINI.md");
    });

    it("should include the root AGENTS.md and .agents/rules entries for antigravity-cli", () => {
      const result = filterGitignoreEntries({ logger, targets: ["antigravity-cli"] });

      // antigravity-cli now emits the project root rule as AGENTS.md (matching
      // antigravity-ide), not GEMINI.md, plus non-root rules under .agents/rules/.
      expect(result).toContain("**/AGENTS.md");
      expect(result).toContain("**/.agents/rules/");
      // The project root is no longer GEMINI.md (that is a geminicli-only entry).
      expect(result).not.toContain("**/GEMINI.md");
    });

    it("should return all entries when target is wildcard", () => {
      const result = filterGitignoreEntries({ logger, targets: ["*"] });
      expect(result).toEqual([...ALL_GITIGNORE_ENTRIES]);
    });
  });

  describe("feature filtering", () => {
    it("should return only matching feature entries plus general entries", () => {
      const result = filterGitignoreEntries({ logger, features: ["rules"] });

      // Should include common/general entries
      expect(result).toContain(".rulesync/skills/.curated/");

      // Should include general entries for all targets
      expect(result).toContain("**/.claude/memories/");
      expect(result).toContain("**/.codex/memories/");

      // Should include rules entries
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.cursor/");
      expect(result).toContain("**/.github/instructions/");

      // Should NOT include non-rules, non-general entries
      expect(result).not.toContain("**/.claude/commands/");
      expect(result).not.toContain("**/.cursorignore");
      expect(result).not.toContain("**/.github/prompts/");
    });

    it("should support multiple features", () => {
      const result = filterGitignoreEntries({ logger, features: ["rules", "commands"] });

      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/commands/");
      expect(result).toContain("**/.github/prompts/");
      expect(result).not.toContain("**/.cursorignore");
    });

    it("should return all entries when feature is wildcard", () => {
      const result = filterGitignoreEntries({ logger, features: ["*"] });
      expect(result).toEqual([...ALL_GITIGNORE_ENTRIES]);
    });
  });

  describe("combined target + feature filtering", () => {
    it("should apply both filters", () => {
      const result = filterGitignoreEntries({
        targets: ["claudecode"],
        features: ["rules"],
      });

      // Common entries always included
      expect(result).toContain(".rulesync/skills/.curated/");

      // claudecode rules
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/rules/");

      // claudecode general (always included for selected target)
      expect(result).toContain("**/.claude/memories/");

      // claudecode non-rules features should NOT be included
      expect(result).not.toContain("**/.claude/commands/");
      expect(result).not.toContain("**/.mcp.json");

      // Other targets should NOT be included
      expect(result).not.toContain("**/.cursor/");
      expect(result).not.toContain("**/.github/instructions/");
    });

    it("should filter copilot with rules and commands", () => {
      const result = filterGitignoreEntries({
        targets: ["copilot"],
        features: ["rules", "commands"],
      });

      expect(result).toContain("**/.github/copilot-instructions.md");
      expect(result).toContain("**/.github/instructions/");
      expect(result).toContain("**/.github/prompts/");
      expect(result).not.toContain("**/.github/agents/");
      expect(result).not.toContain("**/.vscode/mcp.json");
      expect(result).not.toContain("**/CLAUDE.md");
    });
  });

  describe("features as object format (per-target)", () => {
    it("should apply per-target feature filtering", () => {
      const result = filterGitignoreEntries({
        features: {
          claudecode: ["rules"],
          copilot: ["commands"],
        },
      });

      // claudecode rules
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/rules/");

      // copilot commands
      expect(result).toContain("**/.github/prompts/");

      // Shared copilot/copilotcli rule entries stay included because copilotcli
      // is not restricted in this per-target feature map.
      expect(result).toContain("**/.github/copilot-instructions.md");

      // claudecode commands should NOT be included
      expect(result).not.toContain("**/.claude/commands/");

      // Targets not in the object should include all features
      expect(result).toContain("**/.cursor/");
      expect(result).toContain("**/.cursorignore");
    });

    it("should support wildcard in per-target features", () => {
      const result = filterGitignoreEntries({
        features: {
          claudecode: ["*"],
          copilot: ["rules"],
        },
      });

      // claudecode all features
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/commands/");
      expect(result).toContain("**/.mcp.json");

      // copilot rules only
      expect(result).toContain("**/.github/copilot-instructions.md");
      expect(result).not.toContain("**/.github/prompts/");
    });

    it("should combine with target filtering", () => {
      const result = filterGitignoreEntries({
        targets: ["claudecode", "copilot"],
        features: {
          claudecode: ["rules"],
          copilot: ["commands"],
        },
      });

      expect(result).toContain("**/CLAUDE.md");
      expect(result).not.toContain("**/.claude/commands/");
      expect(result).toContain("**/.github/prompts/");
      expect(result).not.toContain("**/.github/copilot-instructions.md");
      expect(result).not.toContain("**/.cursor/");
    });

    it("should include shared entries when copilotcli enables matching features", () => {
      const result = filterGitignoreEntries({
        features: {
          copilot: ["commands"],
          copilotcli: ["rules"],
        },
      });

      expect(result).toContain("**/.github/copilot-instructions.md");
      expect(result).toContain("**/.github/instructions/");
      expect(result).toContain("**/.github/prompts/");
    });
  });

  describe("features as per-feature object format (per-target)", () => {
    it("should apply per-feature object form filtering", () => {
      const result = filterGitignoreEntries({
        features: {
          claudecode: {
            rules: true,
            mcp: { someOption: true },
            commands: false,
          },
        },
      });

      // claudecode rules enabled (boolean true)
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/rules/");

      // claudecode mcp enabled (via options object)
      expect(result).toContain("**/.mcp.json");

      // claudecode commands disabled (boolean false)
      expect(result).not.toContain("**/.claude/commands/");
    });

    it("should support wildcard in per-feature object form", () => {
      const result = filterGitignoreEntries({
        features: {
          claudecode: { "*": true },
          copilot: { rules: true },
        },
      });

      // claudecode all features
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.claude/commands/");
      expect(result).toContain("**/.mcp.json");

      // copilot rules only
      expect(result).toContain("**/.github/copilot-instructions.md");
      expect(result).not.toContain("**/.github/prompts/");
    });
  });

  describe("validation warnings", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, "warn");
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("should warn when an invalid target is provided", () => {
      filterGitignoreEntries({ logger, targets: ["unknown-target"] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown target 'unknown-target'"),
      );
    });

    it("should warn for each invalid target", () => {
      filterGitignoreEntries({ logger, targets: ["claudecode", "foo", "bar"] });
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown target 'foo'"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown target 'bar'"));
    });

    it("should not warn for valid targets", () => {
      filterGitignoreEntries({ logger, targets: ["claudecode", "copilot", "*"] });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("should warn when an invalid feature is provided (array format)", () => {
      filterGitignoreEntries({ logger, features: ["rules", "unknown-feat" as any] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown feature 'unknown-feat'"),
      );
    });

    it("should warn when an invalid feature is provided (object format)", () => {
      filterGitignoreEntries({
        logger,
        features: { claudecode: ["rules", "unknown-feat" as any] },
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown feature 'unknown-feat'"),
      );
    });

    it("should not warn for valid features", () => {
      filterGitignoreEntries({ logger, features: ["rules", "commands", "*"] });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("should deduplicate warnings for the same invalid feature across targets (object format)", () => {
      filterGitignoreEntries({
        logger,
        features: {
          claudecode: ["bogus" as any],
          copilot: ["bogus" as any],
        },
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown feature 'bogus'"));
    });

    it("should warn when an invalid feature key is provided (per-feature object format)", () => {
      filterGitignoreEntries({
        logger,
        features: {
          claudecode: { rules: true, "unknown-feat": true } as any,
        },
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown feature 'unknown-feat'"),
      );
    });
  });

  describe("deduplication", () => {
    it("should not contain duplicate entries in the result", () => {
      const result = filterGitignoreEntries();
      const unique = new Set(result);
      expect(result.length).toBe(unique.size);
    });
  });
});
