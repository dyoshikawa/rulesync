import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { ALL_TOOL_TARGETS } from "../../types/tool-targets.js";
import {
  ALL_GITIGNORE_ENTRIES,
  GITIGNORE_ENTRY_REGISTRY,
  filterGitignoreEntries,
} from "./gitignore-entries.js";

const logger = createMockLogger();

// These targets intentionally have no gitignore entries because they either
// don't generate files (e.g., agentsskills) or share paths with their
// non-legacy counterparts (e.g., augmentcode-legacy → augmentcode).
const TARGETS_WITHOUT_GITIGNORE_ENTRIES = new Set([
  "agentsskills",
  "antigravity",
  "augmentcode-legacy",
  "claudecode-legacy",
  "zed",
]);

describe("GITIGNORE_ENTRY_REGISTRY", () => {
  it("should have no duplicate entries within a single feature tag", () => {
    // The registry intentionally allows the SAME entry to be registered under
    // different feature tags (e.g. `.takt/facets/instructions/` is shared by
    // both `commands` and `skills` for the takt target). The `resolveGitignoreEntries`
    // writer dedupes the final output. What we want to forbid is the same
    // (target, feature, entry) triple appearing twice.
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
