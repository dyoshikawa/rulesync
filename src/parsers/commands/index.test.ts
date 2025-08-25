import { describe, expect, it } from "vitest";
import {
  BaseCommandParser,
  ClaudeCodeCommandParser,
  GeminiCommandParser,
  getAvailableCommandParserTools,
  getCommandParser,
  QwenCodeCommandParser,
} from "./index.js";

describe("Command Parser Registry", () => {
  describe("getCommandParser", () => {
    it("returns ClaudeCodeCommandParser for claudecode", () => {
      const parser = getCommandParser("claudecode");
      expect(parser).toBeInstanceOf(ClaudeCodeCommandParser);
    });

    it("returns GeminiCommandParser for geminicli", () => {
      const parser = getCommandParser("geminicli");
      expect(parser).toBeInstanceOf(GeminiCommandParser);
    });

    it("returns QwenCodeCommandParser for qwencode", () => {
      const parser = getCommandParser("qwencode");
      expect(parser).toBeInstanceOf(QwenCodeCommandParser);
    });

    it("returns undefined for unknown tools", () => {
      const parser = getCommandParser("unknown-tool");
      expect(parser).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      const parser = getCommandParser("");
      expect(parser).toBeUndefined();
    });
  });

  describe("getAvailableCommandParserTools", () => {
    it("returns all registered tool names", () => {
      const tools = getAvailableCommandParserTools();
      expect(tools).toEqual(expect.arrayContaining(["claudecode", "geminicli", "qwencode"]));
      expect(tools).toHaveLength(3);
    });

    it("returns tools in a consistent order", () => {
      const tools1 = getAvailableCommandParserTools();
      const tools2 = getAvailableCommandParserTools();
      expect(tools1).toEqual(tools2);
    });
  });

  describe("Parser Interface Compliance", () => {
    it("all parsers implement the CommandParser interface", () => {
      const tools = getAvailableCommandParserTools();

      for (const tool of tools) {
        const parser = getCommandParser(tool);
        expect(parser).toBeDefined();
        expect(typeof parser!.parseCommands).toBe("function");
        expect(typeof parser!.getCommandsDirectory).toBe("function");
      }
    });

    it("all parsers extend BaseCommandParser", () => {
      const tools = getAvailableCommandParserTools();

      for (const tool of tools) {
        const parser = getCommandParser(tool);
        expect(parser).toBeInstanceOf(BaseCommandParser);
      }
    });

    it("parsers return expected directory paths", () => {
      const claudeParser = getCommandParser("claudecode");
      const geminiParser = getCommandParser("geminicli");
      const qwenParser = getCommandParser("qwencode");

      expect(claudeParser!.getCommandsDirectory()).toBe(".claude/commands");
      expect(geminiParser!.getCommandsDirectory()).toBe(".gemini/commands");
      expect(qwenParser!.getCommandsDirectory()).toBe(".qwen/commands");
    });
  });

  describe("BaseCommandParser", () => {
    it("is properly exported", () => {
      expect(BaseCommandParser).toBeDefined();
      expect(typeof BaseCommandParser).toBe("function");
    });
  });

  describe("Specific Parsers", () => {
    it("exports ClaudeCodeCommandParser", () => {
      expect(ClaudeCodeCommandParser).toBeDefined();
      expect(typeof ClaudeCodeCommandParser).toBe("function");
    });

    it("exports GeminiCommandParser", () => {
      expect(GeminiCommandParser).toBeDefined();
      expect(typeof GeminiCommandParser).toBe("function");
    });

    it("exports QwenCodeCommandParser", () => {
      expect(QwenCodeCommandParser).toBeDefined();
      expect(typeof QwenCodeCommandParser).toBe("function");
    });
  });
});
