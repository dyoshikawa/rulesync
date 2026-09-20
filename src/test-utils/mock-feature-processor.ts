import { vi } from "vitest";

/**
 * The bookkeeping every `FeatureProcessor`/`DirFeatureProcessor` mock needs but
 * no individual test cares about. Spread it into a mock instead of restating
 * the members, so a new hook on the base class is one edit here rather than one
 * per mock literal.
 */
export function mockProcessorBase(): {
  emitsToolFilesForEmptySource: ReturnType<typeof vi.fn>;
  hasRulesyncSourceLoadFailure: ReturnType<typeof vi.fn>;
} {
  return {
    emitsToolFilesForEmptySource: vi.fn().mockReturnValue(false),
    hasRulesyncSourceLoadFailure: vi.fn().mockReturnValue(false),
  };
}
