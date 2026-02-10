/**
 * Result of writing AI files, including both count and file paths
 */
export type WriteResult = {
  count: number;
  paths: string[];
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
    result.hooksCount
  );
}
