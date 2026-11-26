import { describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { skipsReservedPermissionName } from "./reserved-permission-name.js";

describe("skipsReservedPermissionName", () => {
  it.each(["__proto__", "constructor", "prototype"])(
    "should skip and warn about a %s category",
    (category) => {
      const logger = createMockLogger();

      expect(skipsReservedPermissionName({ toolLabel: "Amp", category, logger })).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        `Skipping imported Amp permission rule for "${category}": reserved key names cannot be used as permission categories or patterns.`,
      );
    },
  );

  it("should skip and warn about a reserved pattern", () => {
    const logger = createMockLogger();

    expect(
      skipsReservedPermissionName({
        toolLabel: "Devin",
        category: "bash",
        pattern: "constructor",
        logger,
      }),
    ).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      `Skipping imported Devin permission rule for "bash" pattern "constructor": reserved key names cannot be used as permission categories or patterns.`,
    );
  });

  it("should keep an ordinary rule without warning", () => {
    const logger = createMockLogger();

    expect(
      skipsReservedPermissionName({ toolLabel: "Devin", category: "bash", pattern: "ls", logger }),
    ).toBe(false);
    expect(skipsReservedPermissionName({ toolLabel: "Goose", category: "toString", logger })).toBe(
      false,
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
