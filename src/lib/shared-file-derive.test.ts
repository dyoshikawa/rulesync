import { describe, expect, it } from "vitest";

import type { Feature } from "../types/features.js";
import { GENERATION_STEP_GRAPH } from "./generate.js";
import {
  deriveSharedFileWriters,
  deriveSharedWriteSteps,
  SHARED_WRITE_FEATURE_ORDER,
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
    // deriveSharedWriteSteps throws when a shared-file writer feature is not
    // ordered — a new feature entering the shared-write set must get an
    // explicit precedence decision, not a silent arbitrary order.
    expect(() => deriveSharedWriteSteps()).not.toThrow();
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
          "mcp",
          "permissions",
        ],
        ".config/opencode/opencode.json": [
          "mcp",
          "permissions",
        ],
        ".config/zed/settings.json": [
          "mcp",
          "permissions",
        ],
        ".devin/config.json": [
          "mcp",
          "permissions",
        ],
        ".grok/config.toml": [
          "mcp",
          "permissions",
        ],
        ".hermes/config.yaml": [
          "hooks",
          "mcp",
          "permissions",
          "subagents",
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
          "mcp",
          "permissions",
        ],
        ".takt/config.yaml": [
          "mcp",
          "permissions",
        ],
        ".vibe/config.toml": [
          "hooks",
          "mcp",
          "permissions",
        ],
        ".zed/settings.json": [
          "ignore",
          "mcp",
          "permissions",
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
          "mcp",
          "permissions",
        ],
      }
    `);
  });
});
