import { join } from "node:path";

import { describe, expect, it } from "vitest";
// cspell:ignore gitwildmatch pathspec

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { HermesagentIgnore } from "./hermesagent-ignore.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("HermesagentIgnore", () => {
  it("generates project-local patterns and blocking/filtering plugin hooks", async () => {
    const ignore = HermesagentIgnore.fromRulesyncIgnore({
      rulesyncIgnore: new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".aiignore",
        fileContent: "node_modules/\n.env\n",
      }),
    });
    const auxiliaryFiles = await HermesagentIgnore.getAuxiliaryFiles({ toolIgnore: ignore });
    const init = auxiliaryFiles.find((file) => file.getRelativeFilePath() === "__init__.py");

    expect(ignore.getRelativePathFromCwd()).toBe(
      ".hermes/plugins/rulesync-ignore/patterns.gitignore",
    );
    expect(ignore.getFileContent()).toBe("node_modules/\n.env\n");
    expect(init?.getFileContent()).toContain(
      'ctx.register_hook("pre_tool_call", block_ignored_file_tools)',
    );
    expect(init?.getFileContent()).toContain(
      'ctx.register_hook("transform_tool_result", filter_search_results)',
    );
    expect(init?.getFileContent()).toContain(
      'PROTECTED_TOOLS = {"read_file", "write_file", "patch"}',
    );
    expect(init?.getFileContent()).toContain('pathspec.PathSpec.from_lines("gitwildmatch"');
    expect(init?.getFileContent()).toContain('if parent_key == "files":');
    expect(init?.getFileContent()).toContain('if key == "counts" and isinstance(item, dict):');
    expect(init?.getFileContent()).toContain('if key == "matches_text":');
    expect(init?.getFileContent()).toContain('raw_result.partition("\\n\\n[Hint:")');
    expect(init?.getFileContent()).toContain('re.match(r"^\\*\\*\\*\\s*Move\\s+File:');
    expect(init?.getFileContent()).toContain('re.match(r"^  \\d+: ", line)');
    expect(init?.getFileContent()).toContain("not has_path or not is_match_line");
    expect(init?.getFileContent()).toContain("candidates = [lexical]");
  });

  it("round-trips patterns back to the canonical ignore file", () => {
    const ignore = new HermesagentIgnore({
      relativeDirPath: ".hermes/plugins/rulesync-ignore",
      relativeFilePath: "patterns.gitignore",
      fileContent: "dist/\n",
    });

    expect(ignore.toRulesyncIgnore().getFileContent()).toBe("dist/\n");
  });

  it("cleans auxiliary plugin files only when the ownership marker matches", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const markerPath = join(testDir, ".hermes", "plugins", "rulesync-ignore", ".rulesync-owned");
      await writeFileContent(markerPath, "user-managed\n");
      expect(await HermesagentIgnore.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);
      await writeFileContent(markerPath, "Generated and owned by RuleSync.\n");
      expect(await HermesagentIgnore.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("protects primary plugin data when the ownership marker does not match", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const pluginDir = join(testDir, ".hermes", "plugins", "rulesync-ignore");
      await writeFileContent(join(pluginDir, "patterns.gitignore"), "private/\n");
      await writeFileContent(join(pluginDir, ".rulesync-owned"), "user-managed\n");
      const processor = new IgnoreProcessor({
        outputRoot: testDir,
        toolTarget: "hermesagent",
        logger: createMockLogger(),
      });

      expect(await processor.loadToolFiles({ forDeletion: true })).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});
