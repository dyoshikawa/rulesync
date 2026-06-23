import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KIRO_IGNORE_FILE_NAME } from "../constants/kiro-paths.js";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, runImport, useTestDirectory } from "./e2e-helper.js";

describe("E2E: ignore", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "cursor", outputPath: ".cursorignore", format: "plaintext" as const },
    {
      target: "claudecode",
      outputPath: join(".claude", "settings.json"),
      format: "json" as const,
    },
    { target: "geminicli", outputPath: ".geminiignore", format: "plaintext" as const },
    { target: "antigravity-cli", outputPath: ".geminiignore", format: "plaintext" as const },
    { target: "goose", outputPath: ".gooseignore", format: "plaintext" as const },
    { target: "cline", outputPath: ".clineignore", format: "plaintext" as const },
    { target: "kilo", outputPath: ".kilocodeignore", format: "plaintext" as const },
    { target: "roo", outputPath: ".rooignore", format: "plaintext" as const },
    { target: "qwencode", outputPath: ".qwenignore", format: "plaintext" as const },
    { target: "kiro", outputPath: KIRO_IGNORE_FILE_NAME, format: "plaintext" as const },
    { target: "kiro-cli", outputPath: KIRO_IGNORE_FILE_NAME, format: "plaintext" as const },
    { target: "kiro-ide", outputPath: KIRO_IGNORE_FILE_NAME, format: "plaintext" as const },
    { target: "junie", outputPath: ".aiignore", format: "plaintext" as const },
    { target: "aiassistant", outputPath: ".aiignore", format: "plaintext" as const },
    { target: "augmentcode", outputPath: ".augmentignore", format: "plaintext" as const },
    { target: "devin", outputPath: ".devinignore", format: "plaintext" as const },
    {
      target: "zed",
      outputPath: join(".zed", "settings.json"),
      format: "json" as const,
    },
    { target: "vibe", outputPath: ".vibeignore", format: "plaintext" as const },
    { target: "warp", outputPath: ".warpindexingignore", format: "plaintext" as const },
  ])("should generate $target ignore", async ({ target, outputPath, format }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/.aiignore
    const ignoreContent = `tmp/
credentials/
*.secret
`;
    await writeFileContent(join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH), ignoreContent);

    // Execute: Generate ignore for the target
    await runGenerate({ target, features: "ignore" });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    if (format === "plaintext") {
      expect(generatedContent).toContain("tmp/");
      expect(generatedContent).toContain("credentials/");
    } else if (format === "json" && target === "claudecode") {
      // Claude Code uses JSON format with permissions.deny
      const parsed = JSON.parse(generatedContent);
      expect(parsed.permissions.deny).toBeDefined();
      expect(parsed.permissions.deny).toEqual(
        expect.arrayContaining([expect.stringContaining("tmp/")]),
      );
    } else if (format === "json" && target === "zed") {
      // Zed uses JSON format with private_files
      const parsed = JSON.parse(generatedContent);
      expect(parsed.private_files).toBeDefined();
      expect(parsed.private_files).toEqual(
        expect.arrayContaining([expect.stringContaining("tmp/")]),
      );
    }
  });

  it.each([
    { target: "cursor", orphanPath: ".cursorignore" },
    // claudecode uses settings.json (isDeletable=false) — excluded
    { target: "geminicli", orphanPath: ".geminiignore" },
    { target: "antigravity-cli", orphanPath: ".geminiignore" },
    { target: "goose", orphanPath: ".gooseignore" },
    { target: "cline", orphanPath: ".clineignore" },
    { target: "kilo", orphanPath: ".kilocodeignore" },
    { target: "roo", orphanPath: ".rooignore" },
    { target: "qwencode", orphanPath: ".qwenignore" },
    { target: "kiro", orphanPath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-cli", orphanPath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-ide", orphanPath: KIRO_IGNORE_FILE_NAME },
    { target: "junie", orphanPath: ".aiignore" },
    { target: "augmentcode", orphanPath: ".augmentignore" },
    { target: "devin", orphanPath: ".devinignore" },
    { target: "vibe", orphanPath: ".vibeignore" },
    { target: "warp", orphanPath: ".warpindexingignore" },
    // zed ignore uses .zed/settings.json which is not deletable by rulesync
  ])(
    "should fail in check mode when delete would remove an orphan $target ignore file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, orphanPath), "# orphan\n");

      await expect(
        runGenerate({
          target,
          features: "ignore",
          deleteFiles: true,
          check: true,
          env: { NODE_ENV: "e2e" },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Files are not up to date. Run 'rulesync generate' to update.",
        ),
      });

      expect(await readFileContent(join(testDir, orphanPath))).toBe("# orphan\n");
    },
  );

  it("should succeed in check mode when a claudecode ignore file is non-deletable", async () => {
    const testDir = getTestDir();

    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(
      join(testDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["tmp/"] }, theme: "dark" }, null, 2),
    );

    const { stdout } = await runGenerate({
      target: "claudecode",
      features: "ignore",
      deleteFiles: true,
      check: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(stdout).toContain("All files are up to date.");
  });
});

describe("E2E: ignore (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "cursor", sourcePath: ".cursorignore" },
    { target: "geminicli", sourcePath: ".geminiignore" },
    { target: "antigravity-cli", sourcePath: ".geminiignore" },
    { target: "goose", sourcePath: ".gooseignore" },
    { target: "cline", sourcePath: ".clineignore" },
    { target: "kilo", sourcePath: ".kilocodeignore" },
    { target: "roo", sourcePath: ".rooignore" },
    { target: "qwencode", sourcePath: ".qwenignore" },
    { target: "kiro", sourcePath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-cli", sourcePath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-ide", sourcePath: KIRO_IGNORE_FILE_NAME },
    { target: "junie", sourcePath: ".aiignore" },
    { target: "augmentcode", sourcePath: ".augmentignore" },
    { target: "devin", sourcePath: ".devinignore" },
    { target: "vibe", sourcePath: ".vibeignore" },
    { target: "warp", sourcePath: ".warpindexingignore" },
  ])("should import $target ignore", async ({ target, sourcePath }) => {
    const testDir = getTestDir();

    const ignoreContent = `tmp/
credentials/
*.secret
`;
    await writeFileContent(join(testDir, sourcePath), ignoreContent);

    await runImport({ target, features: "ignore" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
    );
    expect(importedContent).toContain("tmp/");
    expect(importedContent).toContain("credentials/");
  });
});
