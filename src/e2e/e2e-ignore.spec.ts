import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

describe("E2E: ignore", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "cursor", outputPath: ".cursorignore", format: "plaintext" as const },
    {
      target: "claudecode",
      outputPath: join(".claude", "settings.json"),
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
    } else {
      // Claude Code uses JSON format with permissions.deny
      const parsed = JSON.parse(generatedContent);
      expect(parsed.permissions.deny).toBeDefined();
      expect(parsed.permissions.deny).toEqual(
        expect.arrayContaining([expect.stringContaining("tmp/")]),
      );
    }
  });
});
