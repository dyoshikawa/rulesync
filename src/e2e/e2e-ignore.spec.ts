import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
    { target: "goose", outputPath: ".gooseignore", format: "plaintext" as const },
    { target: "cline", outputPath: ".clineignore", format: "plaintext" as const },
    { target: "kilo", outputPath: ".kiloignore", format: "plaintext" as const },
    { target: "roo", outputPath: ".rooignore", format: "plaintext" as const },
    { target: "qwencode", outputPath: ".geminiignore", format: "plaintext" as const },
    { target: "kiro", outputPath: ".aiignore", format: "plaintext" as const },
    { target: "junie", outputPath: ".aiignore", format: "plaintext" as const },
    { target: "augmentcode", outputPath: ".augmentignore", format: "plaintext" as const },
    { target: "windsurf", outputPath: ".codeiumignore", format: "plaintext" as const },
    {
      target: "zed",
      outputPath: join(".zed", "settings.json"),
      format: "json" as const,
    },
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
    { target: "goose", orphanPath: ".gooseignore" },
    { target: "cline", orphanPath: ".clineignore" },
    { target: "kilo", orphanPath: ".kiloignore" },
    { target: "roo", orphanPath: ".rooignore" },
    { target: "qwencode", orphanPath: ".geminiignore" },
    { target: "kiro", orphanPath: ".aiignore" },
    { target: "junie", orphanPath: ".aiignore" },
    { target: "augmentcode", orphanPath: ".augmentignore" },
    { target: "windsurf", orphanPath: ".codeiumignore" },
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
    { target: "goose", sourcePath: ".gooseignore" },
    { target: "cline", sourcePath: ".clineignore" },
    { target: "kilo", sourcePath: ".kiloignore" },
    { target: "roo", sourcePath: ".rooignore" },
    { target: "qwencode", sourcePath: ".geminiignore" },
    { target: "kiro", sourcePath: ".aiignore" },
    { target: "junie", sourcePath: ".aiignore" },
    { target: "augmentcode", sourcePath: ".augmentignore" },
    { target: "windsurf", sourcePath: ".codeiumignore" },
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
