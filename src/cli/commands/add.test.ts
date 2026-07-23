import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceEntry } from "../../config/config.js";
import { resolveAndFetchSources } from "../../lib/sources.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { addCommand } from "./add.js";

vi.mock("../../lib/sources.js");

describe("addCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    logger = createMockLogger();
    vi.mocked(resolveAndFetchSources).mockResolvedValue({
      fetchedSkillCount: 2,
      sourcesProcessed: 2,
      failedSourceCount: 0,
    });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("should append a source, preserve comments, and install all declared sources", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    await writeFileContent(
      configPath,
      `{
  // Keep this project comment.
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    // Keep this source comment.
    { "source": "owner/existing" },
  ],
}
`,
    );

    await addCommand(logger, {
      source: "anthropics/skills",
      skills: ["skill-creator"],
    });

    const updatedContent = await readFileContent(configPath);
    expect(updatedContent).toContain("// Keep this project comment.");
    expect(updatedContent).toContain("// Keep this source comment.");
    const parsed = parseJsonc(updatedContent) as { sources: SourceEntry[] };
    expect(parsed.sources).toEqual([
      { source: "owner/existing" },
      { source: "anthropics/skills", skills: ["skill-creator"] },
    ]);
    expect(resolveAndFetchSources).toHaveBeenCalledWith({
      sources: parsed.sources,
      projectRoot: testDir,
      options: { token: undefined },
      logger,
    });
    expect(logger.success).toHaveBeenCalledWith(
      'Added "anthropics/skills" to rulesync.jsonc and installed 2 skill(s).',
    );
  });

  it("should create the sources property when it is absent", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    await writeFileContent(
      configPath,
      `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
    );

    await addCommand(logger, { source: "owner/new" });

    const parsed = parseJsonc(await readFileContent(configPath)) as { sources: SourceEntry[] };
    expect(parsed.sources).toEqual([{ source: "owner/new" }]);
  });

  it("should reject a duplicate normalized source without modifying the config", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [{ "source": "https://github.com/Owner/Repo.git" }]
}
`;
    await writeFileContent(configPath, originalContent);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(/already declared/);

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a duplicate shared by the GitHub and git transports", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [{ "source": "owner/repo", "transport": "github" }]
}
`;
    await writeFileContent(configPath, originalContent);

    await expect(
      addCommand(logger, {
        source: "https://github.com/owner/repo.git",
        transport: "git",
      }),
    ).rejects.toThrow(/already declared/);

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a missing configuration file", async () => {
    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /Run 'rulesync init' first/,
    );
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject invalid JSONC without modifying the config", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
}
`;
    await writeFileContent(configPath, originalContent);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /Failed to parse rulesync\.jsonc/,
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should roll back the edit when rulesync.local.jsonc overrides sources", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [{ "source": "owner/base" }]
}
`;
    await writeFileContent(configPath, originalContent);
    await writeFileContent(
      join(testDir, "rulesync.local.jsonc"),
      `{
  "sources": [{ "source": "owner/local" }]
}
`,
    );

    await expect(addCommand(logger, { source: "owner/new" })).rejects.toThrow(
      /rulesync\.local\.jsonc.*overrides sources/,
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should retain the manifest entry and report a failed install", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    await writeFileContent(
      configPath,
      `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
    );
    vi.mocked(resolveAndFetchSources).mockResolvedValue({
      fetchedSkillCount: 0,
      sourcesProcessed: 1,
      failedSourceCount: 1,
    });

    await expect(addCommand(logger, { source: "owner/unavailable" })).rejects.toThrow(
      /Added the source.*failed to install/,
    );

    expect(await fileExists(configPath)).toBe(true);
    const parsed = parseJsonc(await readFileContent(configPath)) as { sources: SourceEntry[] };
    expect(parsed.sources).toEqual([{ source: "owner/unavailable" }]);
  });
});
