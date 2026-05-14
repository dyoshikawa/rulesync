import { describe, expect, it } from "vitest";

import { parseArgs, parsePrNumber } from "./pr-continuation.js";

describe("parsePrNumber", () => {
  it("accepts a plain numeric string", () => {
    expect(parsePrNumber("123")).toBe(123);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePrNumber("  456  ")).toBe(456);
  });

  it("extracts the number from a canonical GitHub PR URL", () => {
    expect(parsePrNumber("https://github.com/dyoshikawa/rulesync/pull/789")).toBe(789);
  });

  it("extracts the number from a PR URL with trailing slash", () => {
    expect(parsePrNumber("https://github.com/dyoshikawa/rulesync/pull/789/")).toBe(789);
  });

  it("extracts the number from a PR URL with a /files sub-path", () => {
    expect(parsePrNumber("https://github.com/dyoshikawa/rulesync/pull/789/files")).toBe(789);
  });

  it("extracts the number from a PR URL with a query string", () => {
    expect(
      parsePrNumber("https://github.com/dyoshikawa/rulesync/pull/789?notification_referrer_id=x"),
    ).toBe(789);
  });

  it("extracts the number from a PR URL with an anchor", () => {
    expect(parsePrNumber("https://github.com/dyoshikawa/rulesync/pull/789#issuecomment-1")).toBe(
      789,
    );
  });

  it("rejects zero", () => {
    expect(() => parsePrNumber("0")).toThrow(/Invalid PR identifier/);
  });

  it("rejects leading zeros", () => {
    expect(() => parsePrNumber("0123")).toThrow(/Invalid PR identifier/);
  });

  it("rejects non-numeric, non-URL input", () => {
    expect(() => parsePrNumber("not-a-pr")).toThrow(/Invalid PR identifier/);
  });

  it("rejects empty string", () => {
    expect(() => parsePrNumber("")).toThrow(/Invalid PR identifier/);
  });

  it("rejects shell-metacharacter input", () => {
    expect(() => parsePrNumber("123;rm -rf ~")).toThrow(/Invalid PR identifier/);
  });

  it("rejects an issue URL (no /pull/ segment)", () => {
    expect(() => parsePrNumber("https://github.com/dyoshikawa/rulesync/issues/123")).toThrow(
      /Invalid PR identifier/,
    );
  });
});

describe("parseArgs", () => {
  it("parses a single positional PR identifier with defaults", () => {
    expect(parseArgs(["123"])).toEqual({
      prInput: "123",
      remote: "origin",
      dryRun: false,
    });
  });

  it("accepts --remote with a separate value", () => {
    expect(parseArgs(["123", "--remote", "upstream"])).toEqual({
      prInput: "123",
      remote: "upstream",
      dryRun: false,
    });
  });

  it("accepts --remote=value form", () => {
    expect(parseArgs(["--remote=upstream", "123"])).toEqual({
      prInput: "123",
      remote: "upstream",
      dryRun: false,
    });
  });

  it("accepts --dry-run", () => {
    expect(parseArgs(["--dry-run", "123"])).toEqual({
      prInput: "123",
      remote: "origin",
      dryRun: true,
    });
  });

  it("accepts flags in any order", () => {
    expect(parseArgs(["--dry-run", "--remote", "upstream", "456"])).toEqual({
      prInput: "456",
      remote: "upstream",
      dryRun: true,
    });
  });

  it("throws when no PR identifier is provided", () => {
    expect(() => parseArgs([])).toThrow(/Missing PR identifier/);
  });

  it("throws when --remote has no value", () => {
    expect(() => parseArgs(["123", "--remote"])).toThrow(/--remote requires a value/);
  });

  it("throws when --remote= has empty value", () => {
    expect(() => parseArgs(["123", "--remote="])).toThrow(/--remote requires a value/);
  });

  it("throws when --remote is followed by another flag", () => {
    expect(() => parseArgs(["123", "--remote", "--dry-run"])).toThrow(/--remote requires a value/);
  });

  it("throws on unknown flag", () => {
    expect(() => parseArgs(["--force", "123"])).toThrow(/Unknown flag: --force/);
  });

  it("throws on a second positional argument", () => {
    expect(() => parseArgs(["123", "456"])).toThrow(/Unexpected extra argument: 456/);
  });
});
