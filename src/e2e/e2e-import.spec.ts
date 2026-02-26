import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readFileContent, writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: import", () => {
  const { getTestDir } = useTestDirectory();

  it("should import claudecode rules", async () => {
    const testDir = getTestDir();

    // Setup: Create a CLAUDE.md file to import (modular rules format: ./CLAUDE.md)
    const claudeMdContent = `# Project Overview

This is a test project for E2E testing.
`;
    const claudeMdPath = join(testDir, "CLAUDE.md");
    await writeFileContent(claudeMdPath, claudeMdContent);

    // Execute: Import claudecode rules
    await execFileAsync(rulesyncCmd, [
      ...rulesyncArgs,
      "import",
      "--targets",
      "claudecode",
      "--features",
      "rules",
    ]);

    // Verify that the imported rule file was created
    // Note: The imported file keeps the original filename (CLAUDE.md), not overview.md
    const importedRulePath = join(testDir, ".rulesync", "rules", "CLAUDE.md");
    const importedContent = await readFileContent(importedRulePath);
    expect(importedContent).toContain("Project Overview");
  });
});
