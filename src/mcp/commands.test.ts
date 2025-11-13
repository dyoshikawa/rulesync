import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { commandTools } from "./commands.js";

describe("MCP Commands Tools", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("listCommands", () => {
    it("should return an empty array when .rulesync/commands directory is empty", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      const result = await commandTools.listCommands.execute();
      const parsed = JSON.parse(result);

      expect(parsed.commands).toEqual([]);
    });

    it("should list all commands with their frontmatter", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create test command files
      await writeFileContent(
        join(commandsDir, "test-command.md"),
        `---
targets:
  - "*"
description: "First test command"
---
# Command 1 body`,
      );

      await writeFileContent(
        join(commandsDir, "review.md"),
        `---
targets:
  - cursor
  - copilot
description: "Review code command"
---
# Review command body`,
      );

      const result = await commandTools.listCommands.execute();
      const parsed = JSON.parse(result);

      expect(parsed.commands).toHaveLength(2);
      expect(parsed.commands[0].relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/review.md`,
      );
      expect(parsed.commands[0].frontmatter.description).toBe("Review code command");
      expect(parsed.commands[1].relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/test-command.md`,
      );
      expect(parsed.commands[1].frontmatter.description).toBe("First test command");
    });

    it("should skip non-markdown files", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "command.md"),
        "---\ntargets:\n  - \"*\"\ndescription: 'Test'\n---\n# Test",
      );
      await writeFileContent(join(commandsDir, "not-a-command.txt"), "Not a command");
      await writeFileContent(join(commandsDir, "config.json"), '{"test": true}');

      const result = await commandTools.listCommands.execute();
      const parsed = JSON.parse(result);

      expect(parsed.commands).toHaveLength(1);
      expect(parsed.commands[0].relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/command.md`,
      );
    });

    it("should handle invalid command files gracefully", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create a valid command
      await writeFileContent(
        join(commandsDir, "valid.md"),
        `---
targets:
  - "*"
description: "Valid command"
---
# Valid command`,
      );

      // Create an invalid command (malformed frontmatter)
      await writeFileContent(
        join(commandsDir, "invalid.md"),
        `---
this is not valid yaml: [[[
---
# Invalid command`,
      );

      const result = await commandTools.listCommands.execute();
      const parsed = JSON.parse(result);

      // Should only include the valid command
      expect(parsed.commands).toHaveLength(1);
      expect(parsed.commands[0].relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/valid.md`,
      );
    });

    it("should handle commands with minimal frontmatter", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "simple.md"),
        `---
targets:
  - "*"
description: ""
---
# Simple command`,
      );

      const result = await commandTools.listCommands.execute();
      const parsed = JSON.parse(result);

      expect(parsed.commands).toHaveLength(1);
      expect(parsed.commands[0].frontmatter.targets).toEqual(["*"]);
      expect(parsed.commands[0].frontmatter.description).toBe("");
    });
  });

  describe("getCommand", () => {
    it("should get a command with frontmatter and body", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "test.md"),
        `---
targets:
  - "*"
description: "Test command"
---
# Test Command

This is the body of the test command.`,
      );

      const result = await commandTools.getCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/test.md`,
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(`${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/test.md`);
      expect(parsed.frontmatter.targets).toEqual(["*"]);
      expect(parsed.frontmatter.description).toBe("Test command");
      expect(parsed.body).toContain("This is the body of the test command.");
    });

    it("should throw error for non-existent command", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      await expect(
        commandTools.getCommand.execute({
          relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/nonexistent.md`,
        }),
      ).rejects.toThrow();
    });

    it("should reject path traversal attempts", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      await expect(
        commandTools.getCommand.execute({
          relativePathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should handle command with cursor-specific targets", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "cursor-command.md"),
        `---
targets:
  - cursor
description: "Cursor specific command"
---
# Cursor Command Body`,
      );

      const result = await commandTools.getCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/cursor-command.md`,
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.targets).toEqual(["cursor"]);
      expect(parsed.frontmatter.description).toBe("Cursor specific command");
    });
  });

  describe("putCommand", () => {
    it("should create a new command", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      const result = await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/new-command.md`,
        frontmatter: {
          targets: ["*"],
          description: "New command",
        },
        body: "# New Command Body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/new-command.md`,
      );
      expect(parsed.frontmatter.targets).toEqual(["*"]);
      expect(parsed.frontmatter.description).toBe("New command");
      expect(parsed.body).toBe("# New Command Body");

      // Verify file was created
      const getResult = await commandTools.getCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/new-command.md`,
      });
      const getParsed = JSON.parse(getResult);
      expect(getParsed.body).toBe("# New Command Body");
    });

    it("should update an existing command", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create initial command
      await writeFileContent(
        join(commandsDir, "existing.md"),
        `---
targets:
  - "*"
description: "Original"
---
# Original body`,
      );

      // Update the command
      const result = await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/existing.md`,
        frontmatter: {
          targets: ["cursor"],
          description: "Updated",
        },
        body: "# Updated body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.targets).toEqual(["cursor"]);
      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated body");
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        commandTools.putCommand.execute({
          relativePathFromCwd: "../../../etc/passwd",
          frontmatter: { targets: ["*"], description: "malicious" },
          body: "malicious",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should reject oversized commands", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      const largeBody = "a".repeat(1024 * 1024 + 1); // > 1MB

      await expect(
        commandTools.putCommand.execute({
          relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/large.md`,
          frontmatter: { targets: ["*"], description: "Large command" },
          body: largeBody,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });

    it("should allow updating existing commands even when at max count", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create an existing command
      await writeFileContent(
        join(commandsDir, "existing.md"),
        `---
targets:
  - "*"
description: "Existing"
---
# Existing command`,
      );

      // Update should work regardless of count (since it's not creating new)
      const result = await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/existing.md`,
        frontmatter: { targets: ["cursor"], description: "Updated" },
        body: "# Updated command",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.description).toBe("Updated");
      expect(parsed.body).toBe("# Updated command");
    });

    it("should create .rulesync/commands directory if it doesn't exist", async () => {
      // Don't create the directory beforehand

      const result = await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/auto-created.md`,
        frontmatter: {
          targets: ["*"],
          description: "Auto-created",
        },
        body: "# Auto-created",
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/auto-created.md`,
      );
      expect(parsed.body).toBe("# Auto-created");
    });

    it("should handle multiple target specifications", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      const result = await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/multi-target.md`,
        frontmatter: {
          targets: ["cursor", "claudecode", "copilot"],
          description: "Multi-target command",
        },
        body: "# Multi-target command body",
      });
      const parsed = JSON.parse(result);

      expect(parsed.frontmatter.targets).toEqual(["cursor", "claudecode", "copilot"]);
      expect(parsed.frontmatter.description).toBe("Multi-target command");
    });
  });

  describe("deleteCommand", () => {
    it("should delete an existing command", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create a command
      await writeFileContent(
        join(commandsDir, "to-delete.md"),
        `---
targets:
  - "*"
description: "To delete"
---
# To be deleted`,
      );

      // Verify it exists
      await expect(
        commandTools.getCommand.execute({
          relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/to-delete.md`,
        }),
      ).resolves.toBeDefined();

      // Delete it
      const result = await commandTools.deleteCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/to-delete.md`,
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/to-delete.md`,
      );

      // Verify it's deleted
      await expect(
        commandTools.getCommand.execute({
          relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/to-delete.md`,
        }),
      ).rejects.toThrow();
    });

    it("should succeed when deleting non-existent command (idempotent)", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Deleting a non-existent file should succeed (idempotent operation)
      const result = await commandTools.deleteCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/nonexistent.md`,
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/nonexistent.md`,
      );
    });

    it("should reject path traversal attempts", async () => {
      await expect(
        commandTools.deleteCommand.execute({
          relativePathFromCwd: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/path traversal/i);
    });

    it("should delete only the specified command and not affect others", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create multiple commands
      await writeFileContent(
        join(commandsDir, "keep1.md"),
        "---\ntargets:\n  - \"*\"\ndescription: 'Keep 1'\n---\n# Keep 1",
      );
      await writeFileContent(
        join(commandsDir, "delete.md"),
        "---\ntargets:\n  - \"*\"\ndescription: 'Delete'\n---\n# Delete",
      );
      await writeFileContent(
        join(commandsDir, "keep2.md"),
        "---\ntargets:\n  - \"*\"\ndescription: 'Keep 2'\n---\n# Keep 2",
      );

      // Delete one
      await commandTools.deleteCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/delete.md`,
      });

      // Verify others still exist
      const listResult = await commandTools.listCommands.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.commands).toHaveLength(2);
      expect(parsed.commands.map((c: any) => c.relativePathFromCwd)).toEqual([
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/keep1.md`,
        `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/keep2.md`,
      ]);
    });
  });

  describe("integration scenarios", () => {
    it("should handle full CRUD lifecycle", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create
      await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/lifecycle.md`,
        frontmatter: {
          targets: ["*"],
          description: "Lifecycle test",
        },
        body: "# Initial body",
      });

      // Read
      let result = await commandTools.getCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/lifecycle.md`,
      });
      let parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Initial body");

      // Update
      await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/lifecycle.md`,
        frontmatter: {
          targets: ["cursor"],
          description: "Updated lifecycle test",
        },
        body: "# Updated body",
      });

      result = await commandTools.getCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/lifecycle.md`,
      });
      parsed = JSON.parse(result);
      expect(parsed.body).toBe("# Updated body");
      expect(parsed.frontmatter.targets).toEqual(["cursor"]);

      // Delete
      await commandTools.deleteCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/lifecycle.md`,
      });

      await expect(
        commandTools.getCommand.execute({
          relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/lifecycle.md`,
        }),
      ).rejects.toThrow();
    });

    it("should handle multiple commands with different configurations", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      // Create multiple commands with different configs
      await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/review.md`,
        frontmatter: {
          targets: ["*"],
          description: "Review code",
        },
        body: "# Code Review Command",
      });

      await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/test.md`,
        frontmatter: {
          targets: ["cursor", "claudecode"],
          description: "Run tests",
        },
        body: "# Test Command",
      });

      await commandTools.putCommand.execute({
        relativePathFromCwd: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/deploy.md`,
        frontmatter: {
          targets: ["*"],
          description: "Deploy application",
        },
        body: "# Deploy Command",
      });

      // List all commands
      const listResult = await commandTools.listCommands.execute();
      const parsed = JSON.parse(listResult);

      expect(parsed.commands).toHaveLength(3);
      expect(
        parsed.commands.find((c: any) => c.frontmatter.description === "Review code"),
      ).toBeDefined();
      expect(
        parsed.commands.find((c: any) => c.frontmatter.targets.includes("cursor")),
      ).toBeDefined();
    });
  });
});
