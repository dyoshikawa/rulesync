import { describe, expect, it } from "vite-plus/test";

import {
  buildToolPatternEntry,
  parseToolPatternEntry,
  splitToolRule,
} from "./tool-pattern-entry.js";

describe("parseToolPatternEntry", () => {
  it("should split a Tool(pattern) entry", () => {
    expect(parseToolPatternEntry("Bash(npm run *)")).toEqual({
      toolName: "Bash",
      pattern: "npm run *",
    });
  });

  it("should keep nested parentheses in the pattern", () => {
    expect(parseToolPatternEntry("Bash(echo (a))")).toEqual({
      toolName: "Bash",
      pattern: "echo (a)",
    });
  });

  it("should treat a bare entry as the whole tool", () => {
    expect(parseToolPatternEntry("Read")).toEqual({ toolName: "Read", pattern: "*" });
  });

  it("should fall back to * when the closing parenthesis is missing", () => {
    expect(parseToolPatternEntry("Bash(npm")).toEqual({ toolName: "Bash", pattern: "*" });
    expect(parseToolPatternEntry("Bash(npm) x")).toEqual({ toolName: "Bash", pattern: "*" });
  });

  it("should fall back to * for an empty pattern", () => {
    expect(parseToolPatternEntry("Bash()")).toEqual({ toolName: "Bash", pattern: "*" });
  });
});

describe("buildToolPatternEntry", () => {
  it("should wrap a pattern in parentheses", () => {
    expect(buildToolPatternEntry({ toolName: "Bash", pattern: "npm run *" })).toBe(
      "Bash(npm run *)",
    );
  });

  it("should collapse the * pattern to the bare tool name", () => {
    expect(buildToolPatternEntry({ toolName: "Bash", pattern: "*" })).toBe("Bash");
  });
});

describe("splitToolRule", () => {
  it("splits a Tool(payload) rule, keeping nested parentheses", () => {
    expect(splitToolRule("Bash(echo (a))")).toEqual({ tool: "Bash", payload: "echo (a)" });
  });

  it("returns a bare tool with no payload", () => {
    expect(splitToolRule("Read")).toEqual({ tool: "Read", payload: undefined });
  });

  it("keeps an empty payload", () => {
    expect(splitToolRule("Bash()")).toEqual({ tool: "Bash", payload: "" });
  });

  it("returns a null tool for an unclosed parenthesis", () => {
    expect(splitToolRule("Bash(npm")).toEqual({ tool: null, payload: undefined });
  });
});
