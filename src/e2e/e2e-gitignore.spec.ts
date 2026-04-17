import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_CONFIG_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: gitignore command", () => {
  const { getTestDir } = useTestDirectory();

  it("should write target entries to .gitattributes when tool-level destination is configured", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      `{
  "targets": {
    "claudecode": {
      "$gitignoreDestination": "gitattributes",
      "rules": true
    }
  }
}
`,
    );

    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "gitignore"]);

    const gitignoreContent = await readFileContent(join(testDir, ".gitignore"));
    const gitattributesContent = await readFileContent(join(testDir, ".gitattributes"));

    expect(gitignoreContent).toContain(".rulesync/skills/.curated/");
    expect(gitignoreContent).not.toContain("**/CLAUDE.md");
    expect(gitattributesContent).toContain("**/CLAUDE.md");
  });

  it("should prefer tool x feature destination over tool-level destination", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      `{
  "targets": {
    "claudecode": {
      "$gitignoreDestination": "gitattributes",
      "rules": { "$gitignoreDestination": "gitignore" }
    }
  }
}
`,
    );

    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "gitignore"]);

    const gitignoreContent = await readFileContent(join(testDir, ".gitignore"));
    const gitattributesContent = await readFileContent(join(testDir, ".gitattributes"));

    expect(gitignoreContent).toContain("**/CLAUDE.md");
    expect(gitattributesContent).not.toContain("**/CLAUDE.md");
  });
});
