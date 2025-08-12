import { describe, expect, it, vi } from "vitest";
import type { ParsedCommand } from "../../types/commands.js";
import { GeminiCliCommandGenerator } from "./geminicli.js";

describe("GeminiCliCommandGenerator", () => {
  const generator = new GeminiCliCommandGenerator();

  describe("generate", () => {
    it("should generate a TOML command file with description", () => {
      const command: ParsedCommand = {
        frontmatter: {
          description: "Test command description",
        },
        content: "This is the command content with $ARGUMENTS",
        filename: "test-command",
        filepath: "/path/to/test-command.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.tool).toBe("geminicli");
      expect(result.filepath).toBe("/output/.gemini/commands/test-command.toml");
      expect(result.content).toContain('description = "Test command description"');
      expect(result.content).toContain('prompt = """This is the command content with {{args}}"""');
    });

    it("should generate a TOML command file without description", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Command without description",
        filename: "no-desc",
        filepath: "/path/to/no-desc.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toBe('prompt = """Command without description"""\n');
    });

    it("should preserve directory structure for namespacing", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Test",
        filename: "git/commit",
        filepath: "/path/to/git/commit.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.filepath).toBe("/output/.gemini/commands/git/commit.toml");
    });

    it("should convert $ARGUMENTS to {{args}}", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Do something with $ARGUMENTS and $ARGUMENTS again",
        filename: "test",
        filepath: "/path/to/test.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toContain("{{args}}");
      expect(result.content).not.toContain("$ARGUMENTS");
      expect(result.content).toBe('prompt = """Do something with {{args}} and {{args}} again"""\n');
    });

    it("should convert shell command injection syntax", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Current status: !`git status`",
        filename: "test",
        filepath: "/path/to/test.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toContain("!{git status}");
      expect(result.content).not.toContain("!`");
    });

    it("should warn about @ syntax", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const command: ParsedCommand = {
        frontmatter: {},
        content: "Include @file.txt and @another.md",
        filename: "test",
        filepath: "/path/to/test.md",
      };

      generator.generate(command, "/output");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("@ syntax found (@file.txt, @another.md)"),
      );

      consoleSpy.mockRestore();
    });

    it("should escape special characters in description", () => {
      const command: ParsedCommand = {
        frontmatter: {
          description: 'Test with "quotes" and\nnewlines\ttabs',
        },
        content: "Test",
        filename: "test",
        filepath: "/path/to/test.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toContain('Test with \\"quotes\\" and\\nnewlines\\ttabs');
    });
  });

  describe("getOutputPath", () => {
    it("should return the correct output path with .toml extension", () => {
      const path = generator.getOutputPath("test-command", "/base");
      expect(path).toBe("/base/.gemini/commands/test-command.toml");
    });

    it("should preserve directory structure", () => {
      const path = generator.getOutputPath("deep/nested/command", "/base");
      expect(path).toBe("/base/.gemini/commands/deep/nested/command.toml");
    });

    it("should handle .md extension in filename", () => {
      const path = generator.getOutputPath("command.md", "/base");
      expect(path).toBe("/base/.gemini/commands/command.toml");
    });
  });
});
