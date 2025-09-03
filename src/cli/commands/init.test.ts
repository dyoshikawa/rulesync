import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_COMMANDS_DIR,
  RULESYNC_DIR,
  RULESYNC_RULES_DIR,
  RULESYNC_SUBAGENTS_DIR,
} from "../../constants/paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import * as fileUtils from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { initCommand } from "./init.js";

vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");

describe("initCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    process.chdir(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should create rulesync directory", async () => {
    await initCommand();

    expect(fileUtils.ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
  });

  it("should create all necessary subdirectories", async () => {
    await initCommand();

    expect(fileUtils.ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_DIR);
    expect(fileUtils.ensureDir).toHaveBeenCalledWith(RULESYNC_COMMANDS_DIR);
    expect(fileUtils.ensureDir).toHaveBeenCalledWith(RULESYNC_SUBAGENTS_DIR);
  });

  it("should create sample overview.md file when it doesn't exist", async () => {
    vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

    await initCommand();

    const expectedPath = join(RULESYNC_RULES_DIR, "overview.md");
    expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("# Project Overview"),
    );
    expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("root: true"),
    );
    expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining('targets: ["*"]'),
    );

    expect(logger.success).toHaveBeenCalledWith(`Created ${expectedPath}`);
  });

  it("should skip creating sample file if it already exists", async () => {
    vi.mocked(fileUtils.fileExists).mockResolvedValue(true);

    await initCommand();

    const expectedPath = join(RULESYNC_RULES_DIR, "overview.md");
    expect(fileUtils.writeFileContent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(`Skipped ${expectedPath} (already exists)`);
  });

  it("should show success message and next steps", async () => {
    vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

    await initCommand();

    expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
    expect(logger.info).toHaveBeenCalledWith("Next steps:");
    expect(logger.info).toHaveBeenCalledWith(`1. Edit rule files in ${RULESYNC_RULES_DIR}/`);
    expect(logger.info).toHaveBeenCalledWith(
      "2. Run 'rulesync generate' to create configuration files",
    );
  });

  it("should create valid frontmatter in sample file", async () => {
    vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

    await initCommand();

    const writeCall = vi.mocked(fileUtils.writeFileContent).mock.calls[0];
    const content = writeCall[1];

    // Should contain valid YAML frontmatter
    expect(content).toMatch(/^---\n[\s\S]*?\n---\n/);
    expect(content).toContain("root: true");
    expect(content).toContain('targets: ["*"]');
    expect(content).toContain('description: "Project overview and general development guidelines"');
    expect(content).toContain('globs: ["**/*"]');
  });

  it("should create sample file with comprehensive content", async () => {
    vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

    await initCommand();

    const writeCall = vi.mocked(fileUtils.writeFileContent).mock.calls[0];
    const content = writeCall[1];

    // Check for main sections
    expect(content).toContain("# Project Overview");
    expect(content).toContain("## General Guidelines");
    expect(content).toContain("## Code Style");
    expect(content).toContain("## Architecture Principles");

    // Check for specific guidelines
    expect(content).toContain("Use TypeScript for all new code");
    expect(content).toContain("Use 2 spaces for indentation");
    expect(content).toContain("Organize code by feature, not by file type");
  });
});
