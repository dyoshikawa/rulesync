import { describe, expect, it } from "vitest";
import type { ParsedCommand } from "../../types/commands.js";
import { RooCommandGenerator } from "./roo.js";

describe("RooCommandGenerator", () => {
  const generator = new RooCommandGenerator();

  describe("generate", () => {
    it("should generate a command file with description", () => {
      const command: ParsedCommand = {
        frontmatter: {
          description: "Test command description",
        },
        content: "This is the command content",
        filename: "test-command",
        filepath: "/path/to/test-command.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.tool).toBe("roo");
      expect(result.filepath).toBe("/output/.roo/commands/test-command.md");
      expect(result.content).toContain("---");
      expect(result.content).toContain("description: Test command description");
      expect(result.content).toContain("This is the command content");
    });

    it("should generate a command file with description only", () => {
      const command: ParsedCommand = {
        frontmatter: {
          description: "Test command description",
        },
        content: "Command with description",
        filename: "desc-only",
        filepath: "/path/to/desc-only.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toContain("description: Test command description");
      expect(result.content).toContain("Command with description");
    });

    it("should generate a command file without frontmatter", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Command without frontmatter",
        filename: "no-frontmatter",
        filepath: "/path/to/no-frontmatter.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.content).toBe("---\n---\n\nCommand without frontmatter\n");
    });

    it("should flatten subdirectory names", () => {
      const command: ParsedCommand = {
        frontmatter: {},
        content: "Test",
        filename: "git/commit",
        filepath: "/path/to/git/commit.md",
      };

      const result = generator.generate(command, "/output");

      expect(result.filepath).toBe("/output/.roo/commands/git-commit.md");
    });
  });

  describe("getOutputPath", () => {
    it("should return the correct output path", () => {
      const path = generator.getOutputPath("test-command", "/base");
      expect(path).toBe("/base/.roo/commands/test-command.md");
    });

    it("should flatten nested paths", () => {
      const path = generator.getOutputPath("deep/nested/command", "/base");
      expect(path).toBe("/base/.roo/commands/deep-nested-command.md");
    });
  });
});
