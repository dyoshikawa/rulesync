import { describe, expect, it } from "vitest";
import { ClaudeCodeSubagentParser } from "./claudecode.js";
import { getAvailableSubagentParserTools, getSubagentParser } from "./index.js";

describe("subagents index", () => {
  describe("getSubagentParser", () => {
    it("should return ClaudeCodeSubagentParser for 'claudecode'", () => {
      const parser = getSubagentParser("claudecode");
      expect(parser).toBeInstanceOf(ClaudeCodeSubagentParser);
    });

    it("should return undefined for unknown tool", () => {
      const parser = getSubagentParser("unknown");
      expect(parser).toBeUndefined();
    });

    it("should return parser with correct tool name", () => {
      const parser = getSubagentParser("claudecode");
      expect(parser?.getAgentsDirectory()).toBe(".claude/agents");
    });
  });

  describe("getAvailableSubagentParserTools", () => {
    it("should return array of available tools", () => {
      const tools = getAvailableSubagentParserTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools).toContain("claudecode");
    });

    it("should return at least one tool", () => {
      const tools = getAvailableSubagentParserTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });
});
