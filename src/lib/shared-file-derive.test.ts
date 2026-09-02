import { describe, expect, it } from "vitest";

import { ALL_FEATURES, type Feature } from "../types/features.js";
import { GENERATION_STEP_GRAPH } from "./generate.js";
import {
  deriveSharedFileWriters,
  deriveSharedWriteSteps,
  NON_SHARED_WRITE_FEATURES,
  SHARED_WRITE_FEATURE_ORDER,
  settablePathsForScope,
} from "./shared-file-derive.js";

const graphWritersByFile = (): Map<string, Set<Feature>> => {
  const byFile = new Map<string, Set<Feature>>();
  for (const step of GENERATION_STEP_GRAPH) {
    for (const key of step.writesSharedFile ?? []) {
      const writers = byFile.get(key) ?? new Set<Feature>();
      writers.add(step.id as Feature);
      byFile.set(key, writers);
    }
  }
  return byFile;
};

const derivedWritersByFile = (): Map<string, Set<Feature>> =>
  new Map(deriveSharedFileWriters().map((w) => [w.key, new Set(w.features)]));

const sortedFeatures = (writers: Map<string, Set<Feature>>): Record<string, string[]> =>
  Object.fromEntries(
    [...writers]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, fs]) => [key, [...fs].toSorted()]),
  );

describe("shared-file write derivation", () => {
  it("every feature that writes a shared file has a position in SHARED_WRITE_FEATURE_ORDER", () => {
    // deriveSharedFileWriters considers every feature (not just the ordered
    // ones), so a feature that starts returning a shared path surfaces here and
    // must get an explicit precedence decision, not a silent arbitrary order.
    // Assert the property directly for a clear failure message; before the
    // pre-filter was removed this could never fail because writers were
    // restricted to the order set.
    const ordered = [...SHARED_WRITE_FEATURE_ORDER];
    for (const writer of deriveSharedFileWriters()) {
      for (const feature of writer.features) {
        expect(
          ordered,
          `feature '${feature}' writes shared file '${writer.key}' but has no position in SHARED_WRITE_FEATURE_ORDER`,
        ).toContain(feature);
      }
    }
    // The same guard also throws inside deriveSharedWriteSteps (which generate.ts
    // evaluates at module load), so an unordered writer fails loudly at runtime,
    // not just here.
    expect(() => deriveSharedWriteSteps()).not.toThrow();
  });

  it("classifies every Feature as either a shared writer or an explicit non-shared-writer", () => {
    // Guards #2110 mid#1: SHARED_WRITE_FEATURE_ORDER is hand-maintained, so a
    // feature that later starts writing a shared file could be silently
    // forgotten. Requiring the two lists to partition ALL_FEATURES exactly means
    // adding a Feature forces classifying it in one of them (a duplicate would
    // make `classified` longer than ALL_FEATURES, so this also rejects overlap).
    const classified = [...SHARED_WRITE_FEATURE_ORDER, ...NON_SHARED_WRITE_FEATURES].toSorted();
    expect(classified).toEqual([...ALL_FEATURES].toSorted());
  });

  it("collects getExtraSharedWritePaths even when getSettablePaths throws", () => {
    // Guards #2110 mid#2: the two hooks are independent, so a throwing
    // getSettablePaths must not suppress a tool's (possibly scope-only) extra
    // shared path.
    const cls = {
      getSettablePaths: () => {
        throw new Error("boom");
      },
      getExtraSharedWritePaths: () => [
        { relativeDirPath: ".config/example", relativeFilePath: "example.json" },
      ],
    };

    expect(settablePathsForScope({ cls, global: true })).toEqual([
      { relativeDirPath: ".config/example", relativeFilePath: "example.json" },
    ]);
  });

  it("orders every writer pair of every shared file by dependsOn edges", () => {
    const steps = deriveSharedWriteSteps();
    const orderIndex = new Map<Feature, number>(
      SHARED_WRITE_FEATURE_ORDER.map((feature, index) => [feature, index]),
    );
    for (const writer of deriveSharedFileWriters()) {
      const ordered = [...writer.features].toSorted(
        (a, b) => orderIndex.get(a)! - orderIndex.get(b)!,
      );
      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          expect(
            steps.get(ordered[j]!)?.dependsOn,
            `'${ordered[j]}' must depend on '${ordered[i]}' (both write '${writer.key}')`,
          ).toContain(ordered[i]);
        }
      }
    }
  });

  it("wires the derived shared files into the generation step graph", () => {
    // The graph is built from deriveSharedWriteSteps, so this guards the
    // wiring in generate.ts (e.g. a step forgetting to spread its derived
    // meta), not a hand-maintained duplicate list.
    expect(sortedFeatures(graphWritersByFile())).toEqual(sortedFeatures(derivedWritersByFile()));
  });

  it("pins the derived shared files and their writers for review visibility", () => {
    // Registry changes (a new tool, a new settable path) update this snapshot,
    // making the shared-write surface reviewable in the PR diff instead of
    // hidden inside derivation.
    expect(sortedFeatures(derivedWritersByFile())).toMatchInlineSnapshot(`
      {
        ".amp/settings.json": [
          "mcp",
          "permissions",
        ],
        ".augment/settings.json": [
          "hooks",
          "mcp",
          "permissions",
        ],
        ".claude/settings.json": [
          "hooks",
          "ignore",
          "permissions",
          "rules",
        ],
        ".claude/settings.local.json": [
          "ignore",
          "rules",
        ],
        ".codex/config.toml": [
          "hooks",
          "mcp",
          "permissions",
        ],
        ".config/amp/settings.json": [
          "mcp",
          "permissions",
        ],
        ".config/devin/config.json": [
          "hooks",
          "permissions",
        ],
        ".config/goose/config.yaml": [
          "commands",
          "mcp",
        ],
        ".config/opencode/opencode.json": [
          "mcp",
          "permissions",
          "rules",
        ],
        ".config/zed/settings.json": [
          "ignore",
          "mcp",
          "permissions",
        ],
        ".grok/config.toml": [
          "mcp",
          "permissions",
        ],
        ".hermes/config.yaml": [
          "commands",
          "hooks",
          "mcp",
          "permissions",
          "subagents",
        ],
        ".kimi-code/config.toml": [
          "hooks",
          "mcp",
          "permissions",
        ],
        ".kiro/agents/default.json": [
          "hooks",
          "permissions",
        ],
        ".qwen/settings.json": [
          "hooks",
          "mcp",
          "permissions",
        ],
        ".reasonix/config.toml": [
          "ignore",
          "mcp",
          "permissions",
        ],
        ".rovodev/config.yml": [
          "mcp",
          "permissions",
        ],
        ".takt/config.yaml": [
          "checks",
          "mcp",
          "permissions",
        ],
        ".vibe/config.toml": [
          "mcp",
          "permissions",
        ],
        ".zed/settings.json": [
          "ignore",
          "mcp",
          "permissions",
        ],
        "AppData/Local/hermes/config.yaml": [
          "commands",
          "hooks",
          "mcp",
          "permissions",
          "subagents",
        ],
        "AppData/Roaming/Zed/settings.json": [
          "ignore",
          "mcp",
          "permissions",
        ],
        "config.toml": [
          "hooks",
          "mcp",
          "permissions",
        ],
        "config.yaml": [
          "commands",
          "hooks",
          "mcp",
          "permissions",
          "subagents",
        ],
        "kilo.json": [
          "mcp",
          "rules",
        ],
        "opencode.json": [
          "mcp",
          "permissions",
          "rules",
        ],
        "reasonix.toml": [
          "ignore",
          "mcp",
          "permissions",
        ],
      }
    `);
  });
});
