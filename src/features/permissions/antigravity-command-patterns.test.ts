import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { PermissionAction } from "../../types/permissions.js";
import {
  describeAntigravityCommandImportLoss,
  fromAntigravityCommandTarget,
  importAntigravityCommandTarget,
} from "./antigravity-command-patterns.js";

describe("fromAntigravityCommandTarget", () => {
  it.each([
    ["git status", "git status *"],
    ["*", "*"],
    ["regex:^rm$ ^-rf$", "rm -rf *"],
    ["regex:rm", "rm *"],
    ["rm -rf *", "regex:^rm$ ^-rf$ ^\\*$"],
  ])("imports %s as %s", (target, expected) => {
    expect(fromAntigravityCommandTarget(target)).toBe(expected);
  });
});

describe("describeAntigravityCommandImportLoss", () => {
  it.each([
    "git status",
    "*",
    "regex:^rm$ ^-rf$",
    "regex:^(a|b)$",
    "regex:(a|b)",
    "regex:^rm$ .*",
    "regex:^git$ ^push$ ^-f.*",
  ])("reports nothing for the faithfully imported target %s", (target) => {
    expect(describeAntigravityCommandImportLoss(target)).toBeUndefined();
  });

  it.each(["regex:rm", "regex:^rm$ -rf", "regex:^git$ push$"])(
    "warns that the unanchored regex target %s may be imported narrower",
    (target) => {
      expect(describeAntigravityCommandImportLoss(target)?.reason).toContain(
        "without `^...$` anchors",
      );
    },
  );

  it.each(["rm -rf *", "git push --force?", "ls [ab]"])(
    "warns that the legacy glob-form target %s is matched literally",
    (target) => {
      expect(describeAntigravityCommandImportLoss(target)?.reason).toContain("matches literally");
    },
  );
});

describe("importAntigravityCommandTarget", () => {
  function importTarget({ target, decision }: { target: string; decision: PermissionAction }) {
    const logger = createMockLogger();
    const pattern = importAntigravityCommandTarget({
      target,
      entry: `command(${target})`,
      decision,
      logger,
      toolLabel: "Antigravity IDE",
    });
    return { pattern, logger };
  }

  it("imports a faithful target without a warning", () => {
    const { pattern, logger } = importTarget({ target: "git status", decision: "allow" });
    expect(pattern).toBe("git status *");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps the bare `*` target", () => {
    const { pattern, logger } = importTarget({ target: "*", decision: "allow" });
    expect(pattern).toBe("*");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns that an imported unanchored deny may block less", () => {
    const { pattern, logger } = importTarget({ target: "regex:rm", decision: "deny" });
    expect(pattern).toBe("rm *");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0]?.[0];
    expect(message).toContain("Antigravity IDE permissions");
    expect(message).toContain("may block less");
  });

  it("warns that an imported legacy deny is not enforced by other tools", () => {
    const { logger } = importTarget({ target: "rm -rf *", decision: "deny" });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0]?.[0];
    expect(message).toContain("NOT enforced by the other tools");
    expect(message).not.toContain("may block less");
  });

  it("does not add the deny consequence to an allow", () => {
    const { logger } = importTarget({ target: "regex:rm", decision: "allow" });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).not.toContain("may block less");
  });
});
