import { describe, expect, it } from "vitest";

import type { Feature } from "../types/features.js";
import { GENERATION_STEP_GRAPH } from "./generate.js";
import { deriveSharedFileWriters } from "./shared-file-derive.js";

const declaredWritersByFile = (): Map<string, Set<Feature>> => {
  const byFile = new Map<string, Set<Feature>>();
  for (const step of GENERATION_STEP_GRAPH) {
    for (const key of step.writesSharedFile ?? []) {
      const writers = byFile.get(key) ?? new Set<Feature>();
      writers.add(step.id as Feature);
      byFile.set(key, writers);
    }
  }
  for (const [key, writers] of byFile) {
    if (writers.size < 2) byFile.delete(key);
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

describe("shared-file write declarations", () => {
  it("the generation step graph declares exactly the shared files derived from the registry", () => {
    expect(sortedFeatures(declaredWritersByFile())).toEqual(sortedFeatures(derivedWritersByFile()));
  });

  it("declares no shared file that the registry does not actually share", () => {
    const derived = derivedWritersByFile();
    const undeclared = [...declaredWritersByFile().keys()].filter((key) => !derived.has(key));
    expect(undeclared).toEqual([]);
  });

  it("declares every shared file the registry derives", () => {
    const declared = declaredWritersByFile();
    const missing = [...derivedWritersByFile().keys()].filter((key) => !declared.has(key));
    expect(missing).toEqual([]);
  });
});
