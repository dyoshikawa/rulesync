import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncIgnoreYaml } from "./rulesync-ignore-yaml.js";

describe("RulesyncIgnoreYaml", () => {
  it("should build YAML file content from rules", () => {
    const file = RulesyncIgnoreYaml.fromRules({
      baseDir: "/tmp/test",
      rules: [{ path: "tmp/**", actions: ["read", "write"] }],
    });

    expect(file.getRelativePathFromCwd()).toBe(RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH);
    expect(file.getFileContent()).toContain("version: 1");
    expect(file.getFileContent()).toContain("path: tmp/**");
    expect(file.getFileContent()).toContain("- read");
    expect(file.getFileContent()).toContain("- write");
  });

  it("should read and parse ignore.yaml from disk", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      vi.spyOn(process, "cwd").mockReturnValue(testDir);
      await writeFileContent(
        join(testDir, RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH),
        `version: 1
rules:
  - path: tmp/
    actions: [read]
`,
      );

      const file = await RulesyncIgnoreYaml.fromFile();
      expect(file.getRules()).toEqual([{ path: "tmp/", actions: ["read"] }]);
      expect(file.getWarnings()).toEqual([]);
    } finally {
      await cleanup();
      vi.restoreAllMocks();
    }
  });
});
