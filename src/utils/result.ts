import type { KeyOperation } from "../lib/orphan-sweep.js";

/**
 * Result of writing AI files, including both count and file paths
 */
export type WriteResult = {
  count: number;
  paths: string[];
  /**
   * The owned top-level keys the writes of shared config files add, change or
   * remove; absent when no write touched such a key.
   */
  keyOperations?: KeyOperation[];
};

/**
 * Result of feature generation, extending WriteResult with hasDiff.
 *
 * `sourceLoadFailed` marks a step whose `.rulesync/` source could not be read
 * at all — malformed content, or a schema that rejected it. It is required so
 * that a step which forgets to report it fails to compile rather than silently
 * reading as a clean run: `count: 0` alone cannot tell "nothing to do" apart
 * from "nothing could be read".
 */
export type FeatureGenerateResult = WriteResult & {
  hasDiff: boolean;
  sourceLoadFailed: boolean;
};

/**
 * The number of files each feature touched: the whole result of an import or
 * a convert, and the count fields of a generate.
 */
export type FeatureCounts = {
  rulesCount: number;
  ignoreCount: number;
  mcpCount: number;
  commandsCount: number;
  subagentsCount: number;
  skillsCount: number;
  hooksCount: number;
  permissionsCount: number;
  checksCount: number;
};

/**
 * Common count fields shared by ImportResult and GenerateResult
 */
export type CountableResult = FeatureCounts & {
  activationCount?: number;
  pluginManifestCount?: number;
};

/**
 * Calculate the total count from a result object
 */
export function calculateTotalCount(result: CountableResult): number {
  return (
    result.rulesCount +
    result.ignoreCount +
    result.mcpCount +
    result.commandsCount +
    result.subagentsCount +
    result.skillsCount +
    result.hooksCount +
    result.permissionsCount +
    result.checksCount +
    (result.activationCount ?? 0) +
    (result.pluginManifestCount ?? 0)
  );
}

/**
 * Each feature count in the order every summary, JSON map and MCP result
 * lists it, with the name of the feature in a CLI `features` map and the label
 * of the human-readable summary.
 */
const FEATURE_COUNT_SPECS = [
  { key: "rulesCount", feature: "rules", label: "rules" },
  { key: "ignoreCount", feature: "ignore", label: "ignore files" },
  { key: "mcpCount", feature: "mcp", label: "MCP files" },
  { key: "commandsCount", feature: "commands", label: "commands" },
  { key: "subagentsCount", feature: "subagents", label: "subagents" },
  { key: "skillsCount", feature: "skills", label: "skills" },
  { key: "hooksCount", feature: "hooks", label: "hooks" },
  { key: "permissionsCount", feature: "permissions", label: "permissions" },
  { key: "checksCount", feature: "checks", label: "checks" },
] as const satisfies readonly { key: keyof FeatureCounts; feature: string; label: string }[];

/**
 * The counts only a generate produces, summarized after the feature counts.
 */
const EXTRA_COUNT_SPECS = [
  { key: "activationCount", label: "Hermes activation files" },
  { key: "pluginManifestCount", label: "plugin manifests" },
] as const satisfies readonly { key: keyof CountableResult; label: string }[];

/**
 * Build the human-readable per-feature summary fragments (e.g. "3 rules") for
 * the counts that are at least one.
 */
export function buildFeatureCountSummaryParts(result: CountableResult): string[] {
  const parts: string[] = [];
  for (const { key, label } of [...FEATURE_COUNT_SPECS, ...EXTRA_COUNT_SPECS]) {
    const count = result[key] ?? 0;
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts;
}

/**
 * The `features` map of a CLI `--json` result: `{ rules: { count }, ... }`.
 */
export function featureCountsByFeature(result: FeatureCounts): Record<string, { count: number }> {
  return Object.fromEntries(
    FEATURE_COUNT_SPECS.map(({ key, feature }) => [feature, { count: result[key] }]),
  );
}

/**
 * Copy just the feature counts out of a result, in their canonical order.
 */
export function pickFeatureCounts(result: FeatureCounts): FeatureCounts {
  const counts: Partial<FeatureCounts> = {};
  for (const { key } of FEATURE_COUNT_SPECS) {
    counts[key] = result[key];
  }
  return counts as FeatureCounts;
}
