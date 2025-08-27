import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { GeminiCliCommand } from "./geminicli-command.js";

describe("GeminiCliCommand", () => {
  let _testDir: string;
  let cleanup: () => Promise<void>;

  const createCommand = (content: string) => {
    return new GeminiCliCommand({
      relativeDirPath: "test",
      relativeFilePath: "test.toml",
      fileContent: content,
    });
  };

  beforeEach(async () => {
    ({ testDir: _testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor and basic functionality", () => {
    it("should parse valid TOML command file during construction", () => {
      const tomlContent = `
description = "Test command"
prompt = "This is a test prompt"
`;

      const command = createCommand(tomlContent);

      expect(command.getBody()).toBe("This is a test prompt");
      expect(command.getFrontmatter()).toEqual({
        description: "Test command",
        prompt: "This is a test prompt",
      });
    });

    it("should parse TOML with only prompt field", () => {
      const tomlContent = `
prompt = "This is a test prompt"
`;

      const command = createCommand(tomlContent);

      expect(command.getBody()).toBe("This is a test prompt");
      expect(command.getFrontmatter()).toEqual({
        description: "",
        prompt: "This is a test prompt",
      });
    });

    it("should throw error for invalid TOML", () => {
      const invalidTomlContent = `
description = "Test command
prompt = "This is a test prompt"
`;

      expect(() => createCommand(invalidTomlContent)).toThrow("Failed to parse TOML command file");
    });

    it("should throw error for missing prompt field", () => {
      const tomlContent = `
description = "Test command"
`;

      expect(() => createCommand(tomlContent)).toThrow("Failed to parse TOML command file");
    });
  });

  describe("parseCommandFile", () => {
    it("should parse valid TOML command file", () => {
      const tomlContent = `
description = "Test command"
prompt = "This is a test prompt"
`;

      const command = createCommand("prompt = 'dummy'");
      const result = command["parseCommandFile"](tomlContent);

      expect(result).toEqual({
        filename: "unknown.toml",
        filepath: "unknown.toml",
        frontmatter: {
          description: "Test command",
        },
        content: "This is a test prompt",
      });
    });
  });

  describe("processArgumentPlaceholder", () => {
    it("should replace {{args}} placeholder with arguments", () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Create a plan for {{args}}.";
      const args = "testing feature";

      const result = command["processArgumentPlaceholder"](content, args);

      expect(result).toBe("Create a plan for testing feature.");
    });

    it("should append arguments when no placeholder exists", () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Create a plan for the following requirement:";
      const args = "testing feature";

      const result = command["processArgumentPlaceholder"](content, args);

      expect(result).toBe("Create a plan for the following requirement:\n\ntesting feature");
    });

    it("should handle empty args with placeholder", () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Create a plan for {{args}}.";

      const result = command["processArgumentPlaceholder"](content);

      expect(result).toBe("Create a plan for .");
    });

    it("should return content unchanged when no args and no placeholder", () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Create a plan.";

      const result = command["processArgumentPlaceholder"](content);

      expect(result).toBe("Create a plan.");
    });

    it("should replace multiple {{args}} placeholders", () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "{{args}} and {{args}} should be replaced.";
      const args = "test";

      const result = command["processArgumentPlaceholder"](content, args);

      expect(result).toBe("test and test should be replaced.");
    });
  });

  describe("expandShellCommands", () => {
    it("should expand shell commands with !{ } syntax", async () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Current directory: !{ echo 'test' }";

      const result = await command["expandShellCommands"](content);

      expect(result).toBe("Current directory: test");
    });

    it("should handle multiple shell commands", async () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Echo: !{ echo 'hello' } and Echo2: !{ echo 'world' }";

      const result = await command["expandShellCommands"](content);

      expect(result).toBe("Echo: hello and Echo2: world");
    });

    it("should handle command errors gracefully", async () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Error test: !{ invalid-command-xyz }";

      const result = await command["expandShellCommands"](content);

      expect(result).toContain("Error executing command 'invalid-command-xyz'");
    });

    it("should return content unchanged when no shell commands", async () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "No shell commands here.";

      const result = await command["expandShellCommands"](content);

      expect(result).toBe("No shell commands here.");
    });

    it("should handle shell commands with spaces", async () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Echo test: !{  echo 'spaced'  }";

      const result = await command["expandShellCommands"](content);

      expect(result).toBe("Echo test: spaced");
    });
  });

  describe("processContent", () => {
    it("should process both arguments and shell commands", async () => {
      const command = createCommand("prompt = 'dummy'");
      const content = "Create tests for {{args}}. Files: !{ echo 'test.ts' }";
      const args = "authentication module";

      const result = await command["processContent"](content, args);

      expect(result).toBe("Create tests for authentication module. Files: test.ts");
    });
  });

  describe("directory paths", () => {
    it("should have correct global commands directory", () => {
      const command = createCommand("prompt = 'dummy'");
      const globalDir = command["getGlobalCommandsDirectory"]();
      expect(globalDir).toContain(".gemini");
      expect(globalDir).toContain("commands");
    });

    it("should have correct project commands directory", () => {
      const command = createCommand("prompt = 'dummy'");
      const projectDir = command["getProjectCommandsDirectory"]();
      expect(projectDir).toContain(".gemini");
      expect(projectDir).toContain("commands");
    });
  });

  describe("tool properties", () => {
    it("should have correct tool properties", () => {
      const command = createCommand("prompt = 'dummy'");
      expect(command["toolName"]).toBe("geminicli");
      expect(command["commandsDirectoryName"]).toBe("commands");
      expect(command["supportsNamespacing"]).toBe(true);
      expect(command["fileExtension"]).toBe(".toml");
    });
  });

  describe("integration test with actual files", () => {
    it("should load and process command from TOML file", async () => {
      const tomlContent = `
description = "Generate commit message"
prompt = "Generate a commit message for: {{args}}. Current status: !{ echo 'M  test.ts' }"
`;

      const command = createCommand(tomlContent);
      const processedContent = await command["processContent"](
        command.getBody(),
        "feature implementation",
      );

      expect(processedContent).toBe(
        "Generate a commit message for: feature implementation. Current status: M  test.ts",
      );
    });
  });
});
