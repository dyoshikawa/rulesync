import { vi } from "vitest";

/**
 * The bookkeeping every `FeatureProcessor`/`DirFeatureProcessor` mock needs but
 * no individual test cares about. Spread it into a mock instead of restating
 * the members, so a new hook on the base class is one edit here rather than one
 * per mock literal.
 */
export function mockProcessorBase(): {
  hasRulesyncSourceLoadFailure: ReturnType<typeof vi.fn>;
} {
  return {
    hasRulesyncSourceLoadFailure: vi.fn().mockReturnValue(false),
  };
}
