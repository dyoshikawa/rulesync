import { describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { shouldSkipRule, shouldSkipSkill } from "./sources-artifacts.js";

// Every C0/C1 control character and the bidi controls a terminal acts on.
const isRawControl = (code: number): boolean =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

const hasRawControl = (text: string): boolean =>
  [...text].some((character) => isRawControl(character.codePointAt(0) ?? 0));

const loggedText = (logger: ReturnType<typeof createMockLogger>): string =>
  [logger.warn, logger.info, logger.debug]
    .flatMap((fn) => fn.mock.calls.map((call) => String(call[0])))
    .join(" ");

describe("shouldSkipSkill", () => {
  const baseParams = {
    sourceKey: "https://example.com/repo",
    localSkillNames: new Set<string>(),
    alreadyFetchedSkillNames: new Set<string>(),
  };

  it.each([
    ["an ESC sequence", "notes\u001b[2K-forged"],
    ["a C1 CSI and an OSC 8 opener", "notes\u009b2K\u001b]8;;https:example.invalid\u001b"],
    ["a right-to-left override", `notes${String.fromCodePoint(0x202e)}gpj`],
    ["a zero-width space", `pd${String.fromCodePoint(0x200b)}f`],
  ])("skips a remote skill whose name holds %s and logs no raw control bytes", (_label, name) => {
    const logger = createMockLogger();

    expect(shouldSkipSkill({ ...baseParams, skillName: name, logger })).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unsafe name"));
    expect(hasRawControl(loggedText(logger))).toBe(false);
  });

  it("skips a remote skill whose name Windows folds onto another", () => {
    const logger = createMockLogger();

    expect(shouldSkipSkill({ ...baseParams, skillName: "deploy.", logger })).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Windows resolves it"));
  });

  it("keeps an ordinary skill name", () => {
    const logger = createMockLogger();

    expect(shouldSkipSkill({ ...baseParams, skillName: "pdf-tools", logger })).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("quotes a traversal name without its control characters", () => {
    const logger = createMockLogger();

    expect(shouldSkipSkill({ ...baseParams, skillName: "..\u001b[2K", logger })).toBe(true);
    expect(hasRawControl(loggedText(logger))).toBe(false);
  });
});

describe("shouldSkipRule", () => {
  const baseParams = {
    sourceKey: "https://example.com/repo",
    localRuleNames: new Set<string>(),
    alreadyFetchedRuleNames: new Set<string>(),
  };

  it("skips a remote rule whose name holds control characters and logs none of them", () => {
    const logger = createMockLogger();

    expect(shouldSkipRule({ ...baseParams, ruleName: "style\u009b2K", logger })).toBe(true);
    expect(hasRawControl(loggedText(logger))).toBe(false);
  });

  it("keeps an ordinary rule name", () => {
    const logger = createMockLogger();

    expect(shouldSkipRule({ ...baseParams, ruleName: "coding-style", logger })).toBe(false);
  });
});
