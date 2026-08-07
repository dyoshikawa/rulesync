import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { ALL_TOOL_TARGETS, PACKAGING_TOOL_TARGETS } from "../../types/tool-targets.js";
import {
  deriveAllGitignoreEntries,
  deriveAllGitignoreEntriesUnfiltered,
  DERIVED_PATHS_NOT_GITIGNORED,
} from "./gitignore-derive.js";
import {
  ALL_GITIGNORE_ENTRIES,
  GITIGNORE_ENTRY_REGISTRY,
  HAND_MAINTAINED_GITIGNORE_ENTRIES,
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

const entryKey = (tag: { target: unknown; feature: string; entry: string }): string =>
  `${tag.target}::${tag.feature}::${tag.entry}`;

describe("registry derivation", () => {
  it("registry is the hand-maintained entries plus the derived ones", () => {
    const derived = deriveAllGitignoreEntries();
    const derivedKeys = new Set(derived.map(entryKey));
    const registryKeys = GITIGNORE_ENTRY_REGISTRY.map(entryKey);
    for (const tag of derived) {
      expect(registryKeys, `derived entry missing from registry: ${entryKey(tag)}`).toContain(
        entryKey(tag),
      );
    }
    expect(derivedKeys.size).toBeGreaterThan(0);
  });

  it("every derived entry that rulesync owns is gitignored, not in the exclusion set", () => {
    for (const tag of deriveAllGitignoreEntries()) {
      expect(DERIVED_PATHS_NOT_GITIGNORED.has(tag.entry)).toBe(false);
    }
  });

  // Reverse guard: a typo in DERIVED_PATHS_NOT_GITIGNORED, or a tool path that
  // is later renamed or dropped, would leave a stale exclusion that silently
  // stops excluding anything. Every exclusion-set path must keep matching a
  // path some tool actually emits — except the hand-listed variants a tool
  // emits only under non-default feature options, which default derivation
  // cannot see.
  it("every exclusion-set path matches a real derived output path", () => {
    const conditionallyEmittedExclusions = new Set([
      // Runtime probe twin of `.amp/settings.json` (used when the user already
      // keeps a settings.jsonc).
      "**/.amp/settings.jsonc",
      // claudecode ignore feature with `fileMode: "local"`.
      "**/.claude/settings.local.json",
      // Preferred over `opencode.json` when neither file exists yet, so it is
      // chosen at write time rather than declared by getSettablePaths.
      "**/opencode.jsonc",
    ]);
    const rawEntries = new Set(deriveAllGitignoreEntriesUnfiltered().map((tag) => tag.entry));
    const stale = [...DERIVED_PATHS_NOT_GITIGNORED].filter(
      (entry) => !rawEntries.has(entry) && !conditionallyEmittedExclusions.has(entry),
    );
    expect(stale).toEqual([]);
  });

  // Lock in that user-managed merge-into settings files stay committable: they
  // must never re-appear in the emitted gitignore entries.
  it("user-managed tool config files are not gitignored", () => {
    for (const entry of [
      "**/.codex/config.toml",
      "**/.grok/config.toml",
      "**/.vibe/config.toml",
      "**/reasonix.toml",
    ]) {
      expect(ALL_GITIGNORE_ENTRIES).not.toContain(entry);
    }
  });

  it("no hand-maintained entry duplicates a derived one — the list can't silently rot", () => {
    const derivedKeys = new Set(deriveAllGitignoreEntries().map(entryKey));
    const redundant = HAND_MAINTAINED_GITIGNORE_ENTRIES.filter((tag) =>
      derivedKeys.has(entryKey(tag)),
    ).map(entryKey);
    expect(redundant).toEqual([]);
  });

  // Replaces the old reverse-coverage guard for the hand-maintained list: every
  // non-common entry must stay an explicitly-justified exception, so a renamed or
  // dropped tool path can't leave a stale hand-written entry behind unnoticed.
  // `justified` is deliberately a hand-listed snapshot, not derived from
  // HAND_MAINTAINED_GITIGNORE_ENTRIES — deriving it would make the check a
  // tautology. Adding a hand-maintained entry must be a conscious edit here.
  it("every hand-maintained tool entry is an explicitly justified exception", () => {
    const justified = new Set([
      // rulesync meta files and local-root files (not in any getSettablePaths).
      "claudecode::rules::**/CLAUDE.local.md",
      // Qwen Code's personal project context file, emitted for localRoot rules
      // but never committable (issue #2507).
      "qwencode::rules::**/.qwen/QWEN.local.md",
      "claudecode::rules::**/.claude/CLAUDE.local.md",
      "claudecode::general::**/.claude/*.lock",
      "claudecode::general::**/.claude/settings.local.json",
      "claudecode::general::**/.claude/memories/",
      "opencode::general::**/.opencode/package-lock.json",
      "rovodev::general::**/.rovodev/.rulesync/",
      "takt::general::**/.takt/runs/",
      "takt::general::**/.takt/tasks/",
      "takt::general::**/.takt/.cache/",
      "takt::general::**/.takt/config.yaml",
      // Legacy/aggregate/ghost outputs not produced via getSettablePaths.
      "augmentcode::rules::**/.augment-guidelines",
      "devin::commands::**/.devin/workflows/",
      // Devin's personal MCP override, documented as gitignored and never
      // emitted by rulesync (issue #2510).
      "devin::mcp::**/.devin/mcp_config.local.json",
      "junie::rules::**/.junie/memories/",
      // Legacy outputs of earlier versions (issue #2404): the retired
      // .gooseignore and the inert sub-recipe subagents directory.
      "goose::ignore::**/.gooseignore",
      "goose::subagents::**/.goose/recipes/subagents/",
      // Cline's hook scripts come from getAuxiliaryFiles, not getSettablePaths,
      // and are listed individually so a hand-authored hook stays tracked.
      "cline::hooks::**/.clinerules/hooks/Notification",
      "cline::hooks::**/.clinerules/hooks/Notification.ps1",
      "cline::hooks::**/.clinerules/hooks/PostToolUse",
      "cline::hooks::**/.clinerules/hooks/PostToolUse.ps1",
      "cline::hooks::**/.clinerules/hooks/PreCompact",
      "cline::hooks::**/.clinerules/hooks/PreCompact.ps1",
      "cline::hooks::**/.clinerules/hooks/PreToolUse",
      "cline::hooks::**/.clinerules/hooks/PreToolUse.ps1",
      "cline::hooks::**/.clinerules/hooks/TaskComplete",
      "cline::hooks::**/.clinerules/hooks/TaskComplete.ps1",
      "cline::hooks::**/.clinerules/hooks/TaskStart",
      "cline::hooks::**/.clinerules/hooks/TaskStart.ps1",
      "cline::hooks::**/.clinerules/hooks/UserPromptSubmit",
      "cline::hooks::**/.clinerules/hooks/UserPromptSubmit.ps1",
      // The allowlist is user-scope only; earlier versions wrote a project
      // `.junie/allowlist.json` Junie never reads (issue #2411).
      "junie::permissions::**/.junie/allowlist.json",
      "roo::subagents::**/.roomodes",
      "codexcli::ignore::**/.codexignore",
      // Codex CLI's `.codex/rules/rulesync.rules` bash-permission file is written
      // by createCodexcliBashRulesFile, outside getSettablePaths. Only the
      // rulesync-owned file is ignored, not the whole user-authorable directory.
      "codexcli::permissions::**/.codex/rules/rulesync.rules",
      // Shared trees and global-scope outputs (emitted under the home dir).
      "rovodev::skills::**/.agents/skills/",
      "rovodev::commands::**/.rovodev/prompts.yml",
      "devin::skills::**/.config/devin/skills/",
      "copilotcli::subagents::**/.copilot/agents/",
      "copilotcli::mcp::**/.copilot/mcp-config.json",
      "copilotcli::hooks::**/.copilot/hooks/",
      "hermesagent::ignore::**/.hermes/plugins/rulesync-ignore/",
      "hermesagent::checks::**/.hermes/plugins/rulesync-checks/",
    ]);
    const unjustified = HAND_MAINTAINED_GITIGNORE_ENTRIES.filter((tag) => {
      const targets = Array.isArray(tag.target) ? tag.target : [tag.target];
      if (targets.includes("common")) return false;
      return !justified.has(entryKey(tag));
    }).map(entryKey);
    expect(unjustified).toEqual([]);
  });
});

describe("ALL_GITIGNORE_ENTRIES", () => {
  it("should contain every distinct non-packaging entry from the registry", () => {
    // The registry can register the same entry under multiple feature tags;
    // `ALL_GITIGNORE_ENTRIES` is the default, deduplicated view and excludes
    // package-root paths that must be explicitly requested.
    const defaultRegistryEntries = new Set(
      GITIGNORE_ENTRY_REGISTRY.filter((tag) => {
        const targets = Array.isArray(tag.target) ? tag.target : [tag.target];
        return targets.some(
          (target) =>
            !PACKAGING_TOOL_TARGETS.includes(target as (typeof PACKAGING_TOOL_TARGETS)[number]),
        );
      }).map((tag) => tag.entry),
    );
    expect(ALL_GITIGNORE_ENTRIES.length).toBe(defaultRegistryEntries.size);
    for (const entry of defaultRegistryEntries) {
      expect(ALL_GITIGNORE_ENTRIES).toContain(entry);
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
      // GEMINI.md must NOT be included for this target.
      expect(result).not.toContain("**/GEMINI.md");
    });

    it("should include the root AGENTS.md and .agents/rules entries for antigravity-cli", () => {
      const result = filterGitignoreEntries({ logger, targets: ["antigravity-cli"] });

      // antigravity-cli now emits the project root rule as AGENTS.md (matching
      // antigravity-ide), not GEMINI.md, plus non-root rules under .agents/rules/.
      expect(result).toContain("**/AGENTS.md");
      expect(result).toContain("**/.agents/rules/");
      // The project root is AGENTS.md, not GEMINI.md.
      expect(result).not.toContain("**/GEMINI.md");
    });

    it("should return all entries when target is wildcard", () => {
      const result = filterGitignoreEntries({ logger, targets: ["*"] });
      const nonPackagingEntries = new Set(
        GITIGNORE_ENTRY_REGISTRY.filter((tag) => {
          const targets = Array.isArray(tag.target) ? tag.target : [tag.target];
          return targets.some(
            (target) =>
              !PACKAGING_TOOL_TARGETS.includes(target as (typeof PACKAGING_TOOL_TARGETS)[number]),
          );
        }).map((tag) => tag.entry),
      );
      const packagingEntries = GITIGNORE_ENTRY_REGISTRY.filter((tag) => {
        const targets = Array.isArray(tag.target) ? tag.target : [tag.target];
        return targets.some((target) =>
          PACKAGING_TOOL_TARGETS.includes(target as (typeof PACKAGING_TOOL_TARGETS)[number]),
        );
      })
        .map((tag) => tag.entry)
        .filter((entry) => !nonPackagingEntries.has(entry));

      for (const entry of packagingEntries) {
        expect(result).not.toContain(entry);
      }
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include plugin package paths only when explicitly targeted", () => {
      const defaults = filterGitignoreEntries({ logger });
      const wildcard = filterGitignoreEntries({ logger, targets: ["*"] });
      const claudePlugin = filterGitignoreEntries({
        logger,
        targets: ["claudecode-plugin"],
      });
      const antigravityPlugin = filterGitignoreEntries({
        logger,
        targets: ["antigravity-plugin"],
      });
      const wildcardAndClaudePlugin = filterGitignoreEntries({
        logger,
        targets: ["*", "claudecode-plugin"],
      });

      expect(defaults).not.toContain("**/commands/");
      expect(defaults).not.toContain("**/rules/");
      expect(wildcard).not.toContain("**/commands/");
      expect(wildcard).not.toContain("**/rules/");
      expect(claudePlugin).toContain("**/commands/");
      expect(antigravityPlugin).toContain("**/rules/");
      expect(wildcardAndClaudePlugin).toContain("**/commands/");
      expect(wildcardAndClaudePlugin).not.toContain("**/rules/");
    });
  });

  describe("feature filtering", () => {
    it("should return only matching feature entries plus general entries", () => {
      const result = filterGitignoreEntries({ logger, features: ["rules"] });

      // Should include common/general entries
      expect(result).toContain(".rulesync/skills/.curated/");

      // Should include general entries for all targets
      expect(result).toContain("**/.claude/memories/");

      // codexcli no longer emits .codex/memories/ (non-root rules are folded
      // into the root AGENTS.md — see issue #1765)
      expect(result).not.toContain("**/.codex/memories/");

      // Should include rules entries
      expect(result).toContain("**/CLAUDE.md");
      expect(result).toContain("**/.cursor/rules/");
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

    it("should not warn for valid features", () => {
      filterGitignoreEntries({ logger, features: ["rules", "commands", "*"] });
      expect(warnSpy).not.toHaveBeenCalled();
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

describe("committedOutput check outputs", () => {
  it("never derives gitignore entries for outputs upstream reads from the committed repo", async () => {
    const derive = await import("./gitignore-derive.js");
    const entries = derive.deriveAllGitignoreEntries().map((tag) => tag.entry);
    // Bugbot / Rovo Dev's reviewer only see these files when committed;
    // ignoring them would disable the checks feature (#2487).
    expect(entries).not.toContain("**/.cursor/BUGBOT.md");
    expect(entries).not.toContain("**/.rovodev/.review-agent.md");
  });

  it("keeps the committedOutput flag meaningful (at least one checks factory sets it)", async () => {
    const { toolCheckFactories } = await import("../../features/checks/checks-processor.js");
    const flagged = [...toolCheckFactories.values()].filter(
      (factory) => factory.meta.committedOutput === true,
    );
    expect(flagged.length).toBeGreaterThan(0);
  });
});
