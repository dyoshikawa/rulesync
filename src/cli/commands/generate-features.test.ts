import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { generateCommand } from "./generate.js";

describe("generate command with --features option", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;

    // Setup basic rulesync structure
    const rulesDir = join(testDir, ".rulesync", "rules");
    await writeFileContent(
      join(rulesDir, "test-rule.md"),
      `---
root: true
targets: ["copilot", "claudecode"]
description: "Test rule for features functionality"
---

# Test Rule
This is a test rule for testing the features functionality.`,
    );

    // Basic rulesync config
    const config = {
      targets: ["copilot", "claudecode"],
    };
    await writeFileContent(join(testDir, "rulesync.jsonc"), JSON.stringify(config, null, 2));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should generate only rules when --features rules is specified", async () => {
    process.chdir(testDir);

    // Mock logger.warn to capture backward compatibility warning
    const warnSpy = vi.spyOn(logger, "warn");
    const warnMessages: string[] = [];
    warnSpy.mockImplementation((message: string) => {
      warnMessages.push(message);
    });

    try {
      await generateCommand({
        features: ["rules"],
        verbose: true,
      });

      // Should not show backward compatibility warning when features is specified
      const backwardCompatWarnings = warnMessages.filter((msg) =>
        msg.includes("No --features option specified"),
      );
      expect(backwardCompatWarnings).toHaveLength(0);

      // Check that rule files were generated
      const { fileExists } = await import("../../utils/file.js");
      expect(
        await fileExists(join(testDir, ".github", "instructions", "test-rule.instructions.md")),
      ).toBe(true);
      expect(await fileExists(join(testDir, "CLAUDE.md"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("should show backward compatibility warning when no features specified", async () => {
    process.chdir(testDir);

    // Mock logger.warn to capture backward compatibility warning
    const warnSpy = vi.spyOn(logger, "warn");
    const warnMessages: string[] = [];
    warnSpy.mockImplementation((message: string) => {
      warnMessages.push(message);
    });

    try {
      await generateCommand({
        verbose: true,
      });

      // Should show backward compatibility warning
      expect(warnMessages.some((msg) => msg.includes("No --features option specified"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("should generate only commands when --features commands is specified", async () => {
    process.chdir(testDir);

    // Create commands directory with sample command
    const commandsDir = join(testDir, ".rulesync", "commands");
    await writeFileContent(
      join(commandsDir, "test-command.md"),
      "# Test Command\nThis is a test command.",
    );

    await generateCommand({
      features: ["commands"],
      verbose: true,
    });

    // Should generate command files but not rule files
    const { fileExists } = await import("../../utils/file.js");

    // Commands should be generated (if available for the tool)
    // Note: Actual command generation depends on the tool support

    // Rules should not be generated
    expect(await fileExists(join(testDir, ".github", "copilot-instructions.md"))).toBe(false);
    expect(await fileExists(join(testDir, "CLAUDE.md"))).toBe(false);
  });

  it("should accept wildcard '*' for all features", async () => {
    process.chdir(testDir);

    await generateCommand({
      features: "*",
      verbose: true,
    });

    // Should generate rule files (other features depend on availability)
    const { fileExists } = await import("../../utils/file.js");
    expect(
      await fileExists(join(testDir, ".github", "instructions", "test-rule.instructions.md")),
    ).toBe(true);
    expect(await fileExists(join(testDir, "CLAUDE.md"))).toBe(true);
  });

  it("should handle multiple features", async () => {
    process.chdir(testDir);

    await generateCommand({
      features: ["rules", "mcp"],
      verbose: true,
    });

    // Should generate rule files
    const { fileExists } = await import("../../utils/file.js");
    expect(
      await fileExists(join(testDir, ".github", "instructions", "test-rule.instructions.md")),
    ).toBe(true);
    expect(await fileExists(join(testDir, "CLAUDE.md"))).toBe(true);

    // MCP files depend on mcp.json existence
  });

  it("should respect config file features setting", async () => {
    process.chdir(testDir);

    // Update config to include features
    const config = {
      targets: ["copilot", "claudecode"],
      features: ["rules"],
    };
    await writeFileContent(join(testDir, "rulesync.jsonc"), JSON.stringify(config, null, 2));

    // Mock logger.warn to ensure no warning when config has features
    const warnSpy = vi.spyOn(logger, "warn");
    const warnMessages: string[] = [];
    warnSpy.mockImplementation((message: string) => {
      warnMessages.push(message);
    });

    try {
      await generateCommand({
        verbose: true,
      });

      // Should not show warning when config file has features
      expect(warnMessages.some((msg) => msg.includes("No --features option specified"))).toBe(
        false,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
