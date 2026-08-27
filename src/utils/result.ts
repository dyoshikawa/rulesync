/**
 * Result of writing AI files, including both count and file paths
 */
export type WriteResult = {
  count: number;
  paths: string[];
};

/**
 * Result of feature generation, extending WriteResult with hasDiff.
 *
 * `sourceLoadFailed` marks a step whose `.rulesync/` source could not be read
 * at all — malformed content, or a schema that rejected it. Omitting it means
 * every source the step needed was read, which is why it is optional: a step
 * that has no way to fail this way says nothing.
 */
export type FeatureGenerateResult = WriteResult & {
  hasDiff: boolean;
  sourceLoadFailed?: boolean;
};

/**
 * Common count fields shared by ImportResult and GenerateResult
 */
export type CountableResult = {
  rulesCount: number;
  ignoreCount: number;
  mcpCount: number;
  commandsCount: number;
  subagentsCount: number;
  skillsCount: number;
  hooksCount: number;
  permissionsCount: number;
  checksCount: number;
  activationCount?: number;
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
    (result.activationCount ?? 0)
  );
}
