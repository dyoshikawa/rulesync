import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import {
  collectRestrictionLosingSandboxEntries,
  collectTrustAffectingSandboxPaths,
  isNonEmptyList,
  isNonEmptyMap,
  isNotFalse,
  isNotTrue,
  readSandboxPath,
  replacedUnreadableReason,
  type RestrictionLosingSandboxPath,
  type TrustAffectingSandboxPath,
  UNREADABLE_SANDBOX_PATH,
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

  describe("isNotTrue", () => {
    it("should treat only an explicit true as the quiet value", () => {
      expect(isNotTrue(true)).toBe(false);
      expect(isNotTrue(false)).toBe(true);
      expect(isNotTrue("true")).toBe(true);
      expect(isNotTrue(undefined)).toBe(true);
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

    it("should report an unreadable path when a segment is not an object", () => {
      // A hostile shape is reported rather than read as absent: the leaf cannot
      // be inspected, and silence would claim it cannot loosen anything.
      expect(readSandboxPath({ sandbox: { excluded: "nope" }, path: ["excluded", "allow"] })).toBe(
        UNREADABLE_SANDBOX_PATH,
      );
      expect(readSandboxPath({ sandbox: { excluded: null }, path: ["excluded", "allow"] })).toBe(
        UNREADABLE_SANDBOX_PATH,
      );
      // An absent segment stays `undefined` — nothing is being written there.
      expect(readSandboxPath({ sandbox: {}, path: ["excluded", "allow", "deep"] })).toBeUndefined();
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

    it("should report the container itself when it is not an object", () => {
      // `excluded` is a list here, so no leaf under it can be read. The
      // container is named once, not once per row it hides, and the reason says
      // what is actually known: the shape blocks the check.
      const entries = collectTrustAffectingSandboxPaths({
        sandbox: { excluded: ["Exec(rm -rf /)"] },
        paths: [
          ...paths,
          { path: ["excluded", "ask"], reason: "escapes the sandbox", widens: isNonEmptyList },
        ],
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.label).toBe("sandbox.excluded");
      expect(entries[0]?.reason).toContain("nothing under it can be checked");
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

  describe("collectRestrictionLosingSandboxEntries", () => {
    const paths: readonly RestrictionLosingSandboxPath[] = [
      {
        path: ["denied"],
        reason: "drops entries the file kept out",
        loosens: ({ before, after }) => before.some((entry) => !after.includes(entry)),
      },
      {
        path: ["excluded", "deny"],
        reason: "drops nested entries the file kept out",
        loosens: ({ before, after }) => before.some((entry) => !after.includes(entry)),
      },
    ];

    it("reports a list the merge shortens", () => {
      const entries = collectRestrictionLosingSandboxEntries({
        existing: { denied: ["a", "b"] },
        merged: { denied: ["a"] },
        paths,
        toolLabel: "Tool",
      });

      expect(entries).toEqual([
        { label: "sandbox.denied", reason: "drops entries the file kept out" },
      ]);
    });

    it("stays quiet about a list the merge only adds to, or does not touch", () => {
      expect(
        collectRestrictionLosingSandboxEntries({
          existing: { denied: ["a"] },
          merged: { denied: ["a", "b"] },
          paths,
          toolLabel: "Tool",
        }),
      ).toEqual([]);

      // The same array instance means the overlay never wrote the key.
      const untouched = ["a"];
      expect(
        collectRestrictionLosingSandboxEntries({
          existing: { denied: untouched },
          merged: { denied: untouched },
          paths,
          toolLabel: "Tool",
        }),
      ).toEqual([]);
    });

    it("reports a value the file holds in a shape that cannot be diffed", () => {
      const entries = collectRestrictionLosingSandboxEntries({
        existing: { denied: "a" },
        merged: { denied: ["b"] },
        paths,
        toolLabel: "Tool",
      });

      expect(entries).toEqual([
        {
          label: "sandbox.denied",
          reason: replacedUnreadableReason({ shape: "list", toolLabel: "Tool" }),
        },
      ]);
    });

    it("names an unreadable container once, however many rows it hides", () => {
      const entries = collectRestrictionLosingSandboxEntries({
        existing: { excluded: "off", denied: ["a"] },
        merged: { excluded: { deny: [] }, denied: ["a", "b"] },
        paths: [
          ...paths,
          {
            path: ["excluded", "other"],
            reason: "also under the same container",
            loosens: () => true,
          },
        ],
        toolLabel: "Tool",
      });

      expect(entries).toEqual([
        {
          label: "sandbox.excluded",
          reason: replacedUnreadableReason({ shape: "object", toolLabel: "Tool" }),
        },
      ]);
    });

    it("says nothing about a path the file does not have", () => {
      expect(
        collectRestrictionLosingSandboxEntries({
          existing: {},
          merged: { denied: [] },
          paths,
          toolLabel: "Tool",
        }),
      ).toEqual([]);
    });
  });
});
