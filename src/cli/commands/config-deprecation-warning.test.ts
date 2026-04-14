import { describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { warnDeprecatedConfigPatterns } from "./config-deprecation-warning.js";

describe("warnDeprecatedConfigPatterns", () => {
  it("should warn when root.features object format is used", () => {
    const logger = createMockLogger();
    const config = {
      hasPerTargetFeatures: vi.fn().mockReturnValue(true),
    } as any;

    warnDeprecatedConfigPatterns({ config, logger });

    expect(logger.warn).toHaveBeenCalledWith(
      "Deprecated: root.features object format is deprecated. For fine-grained per-target settings, use root.targets instead.",
    );
  });

  it("should not warn when root.features array format is used", () => {
    const logger = createMockLogger();
    const config = {
      hasPerTargetFeatures: vi.fn().mockReturnValue(false),
    } as any;

    warnDeprecatedConfigPatterns({ config, logger });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
