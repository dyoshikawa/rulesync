import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import {
  collectTrustAffectingSandboxPaths,
  isNonEmptyList,
  isNonEmptyMap,
  isNotFalse,
  readSandboxPath,
  type TrustAffectingSandboxPath,
  warnOnTrustAffectingEntries,
} from "./sandbox-trust.js";

describe("sandbox-trust", () => {
  describe("isNotFalse", () => {
    it("should treat only an explicit false as the quiet value", () => {
      expect(isNotFalse(false)).toBe(false);
      expect(isNotFalse(true)).toBe(true);
      // A malformed value is not a reason to go quiet about a permissive key.
      expect(isNotFalse("false")).toBe(true);
      expect(isNotFalse(null)).toBe(true);
    });
  });

  describe("isNonEmptyList", () => {
    it("should widen for a populated list and for anything that is not a list", () => {
      expect(isNonEmptyList([])).toBe(false);
      expect(isNonEmptyList(["Exec(git status *)"])).toBe(true);
      expect(isNonEmptyList("Exec(git status *)")).toBe(true);
    });
  });

  describe("isNonEmptyMap", () => {
    it("should widen for a populated map and for anything that is not a map", () => {
      expect(isNonEmptyMap({})).toBe(false);
      expect(isNonEmptyMap({ key: "value" })).toBe(true);
      expect(isNonEmptyMap([])).toBe(true);
    });
  });

  describe("readSandboxPath", () => {
    it("should read a nested path", () => {
      expect(
        readSandboxPath({ sandbox: { excluded: { allow: ["a"] } }, path: ["excluded", "allow"] }),
      ).toEqual(["a"]);
    });

    it("should return undefined for a missing segment", () => {
      expect(readSandboxPath({ sandbox: {}, path: ["excluded", "allow"] })).toBeUndefined();
    });

    it("should return undefined when a segment is not an object", () => {
      // A hostile shape reads as absent instead of throwing.
      expect(
        readSandboxPath({ sandbox: { excluded: "nope" }, path: ["excluded", "allow"] }),
      ).toBeUndefined();
      expect(readSandboxPath({ sandbox: { excluded: null }, path: ["excluded", "allow"] })).toBe(
        undefined,
      );
    });

    it("should return the sandbox itself for an empty path", () => {
      const sandbox = { network_mode: "full" };
      expect(readSandboxPath({ sandbox, path: [] })).toBe(sandbox);
    });
  });

  describe("collectTrustAffectingSandboxPaths", () => {
    const paths: readonly TrustAffectingSandboxPath[] = [
      { path: ["network_mode"], reason: "opens every HTTP method", widens: (v) => v !== "limited" },
      { path: ["excluded", "allow"], reason: "escapes the sandbox", widens: isNonEmptyList },
    ];

    it("should collect only the paths whose value widens", () => {
      expect(
        collectTrustAffectingSandboxPaths({
          sandbox: { network_mode: "full", excluded: { allow: [] } },
          paths,
        }),
      ).toEqual([{ label: "sandbox.network_mode", reason: "opens every HTTP method" }]);
    });

    it("should skip an absent path even when the predicate would widen", () => {
      // `undefined` means the key is not being written, so there is nothing to
      // announce — even though `widens` would say `undefined !== "limited"`.
      expect(collectTrustAffectingSandboxPaths({ sandbox: {}, paths })).toEqual([]);
    });

    it("should label a nested path with dots", () => {
      expect(
        collectTrustAffectingSandboxPaths({
          sandbox: { excluded: { allow: ["Exec(git status *)"] } },
          paths,
        }),
      ).toEqual([{ label: "sandbox.excluded.allow", reason: "escapes the sandbox" }]);
    });
  });

  describe("warnOnTrustAffectingEntries", () => {
    it("should stay silent when nothing is trust-affecting", () => {
      const logger = createMockLogger();
      warnOnTrustAffectingEntries({
        toolLabel: "Claude Code",
        entries: [],
        relativeFilePath: ".claude/settings.json",
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should name a single setting in the singular", () => {
      const logger = createMockLogger();
      warnOnTrustAffectingEntries({
        toolLabel: "Claude Code",
        entries: [{ label: "sandbox.autoAllowNetwork", reason: "reaches every host" }],
        relativeFilePath: ".claude/settings.json",
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [warning] = logger.warn.mock.calls[0] as [string];
      expect(warning).toContain("Claude Code permissions:");
      expect(warning).toContain("1 trust-affecting setting to .claude/settings.json");
      expect(warning).toContain("review it as you would a hook");
      expect(warning).toContain("'sandbox.autoAllowNetwork' — reaches every host");
    });

    it("should join several entries into one plural message with a caller-chosen noun", () => {
      const logger = createMockLogger();
      warnOnTrustAffectingEntries({
        toolLabel: "Devin",
        noun: "sandbox change",
        entries: [
          { label: "sandbox.network_mode", reason: "opens every HTTP method" },
          { label: "sandbox.excluded.allow", reason: "escapes the sandbox" },
        ],
        relativeFilePath: ".config/devin/config.json",
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [warning] = logger.warn.mock.calls[0] as [string];
      expect(warning).toContain("Devin permissions:");
      expect(warning).toContain("2 trust-affecting sandbox changes to .config/devin/config.json");
      expect(warning).toContain("review them as you would a hook");
      expect(warning).toContain(
        "'sandbox.network_mode' — opens every HTTP method; 'sandbox.excluded.allow' — escapes the sandbox.",
      );
    });

    it("should not throw when no logger is supplied", () => {
      expect(() =>
        warnOnTrustAffectingEntries({
          toolLabel: "Devin",
          entries: [{ label: "sandbox.network_mode", reason: "opens every HTTP method" }],
          relativeFilePath: ".config/devin/config.json",
        }),
      ).not.toThrow();
    });
  });
});
