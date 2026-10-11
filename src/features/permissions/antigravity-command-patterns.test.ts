import { describe, expect, it } from "vitest";

import {
  describeAntigravityCommandImportLoss,
  fromAntigravityCommandTarget,
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
  it.each(["git status", "*", "regex:^rm$ ^-rf$", "regex:^(a|b)$", "regex:(a|b)"])(
    "reports nothing for the faithfully imported target %s",
    (target) => {
      expect(describeAntigravityCommandImportLoss(target)).toBeUndefined();
    },
  );

  it.each(["regex:rm", "regex:^rm$ -rf", "regex:^git$ push$"])(
    "warns that the unanchored regex target %s may be imported narrower",
    (target) => {
      expect(describeAntigravityCommandImportLoss(target)).toContain("without `^...$` anchors");
    },
  );

  it.each(["rm -rf *", "git push --force?", "ls [ab]"])(
    "warns that the legacy glob-form target %s is matched literally",
    (target) => {
      expect(describeAntigravityCommandImportLoss(target)).toContain("matches literally");
    },
  );
});
