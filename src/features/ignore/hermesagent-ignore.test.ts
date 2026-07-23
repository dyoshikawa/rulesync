import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
// cspell:ignore gitwildmatch pathspec staticmethod

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { HermesagentIgnore } from "./hermesagent-ignore.js";
import { IgnoreProcessor } from "./ignore-processor.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

const execFileAsync = promisify(execFile);

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
    expect(init?.getFileContent()).toContain("and _project_path_exists(line)");
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

  it.runIf(process.platform !== "win32")(
    "filters dense search paths without treating matching content as a path",
    async () => {
      const { testDir, cleanup } = await setupTestDirectory();
      try {
        const pluginDir = join(testDir, ".hermes", "plugins", "rulesync-ignore");
        const ignore = HermesagentIgnore.fromRulesyncIgnore({
          outputRoot: testDir,
          rulesyncIgnore: new RulesyncIgnore({
            relativeDirPath: ".rulesync",
            relativeFilePath: ".aiignore",
            fileContent: "*.key\n  123: secret\n",
          }),
        });
        const auxiliaryFiles = await HermesagentIgnore.getAuxiliaryFiles({
          toolIgnore: ignore,
          outputRoot: testDir,
        });
        const init = auxiliaryFiles.find((file) => file.getRelativeFilePath() === "__init__.py");
        if (!init) throw new Error("Hermes ignore plugin was not generated");

        await writeFileContent(join(pluginDir, "__init__.py"), init.getFileContent());
        await writeFileContent(join(pluginDir, "patterns.gitignore"), ignore.getFileContent());
        await writeFileContent(join(testDir, "allowed.txt"), "allowed\n");
        await writeFileContent(join(testDir, "  123: secret"), "ignored\n");
        await writeFileContent(
          join(pluginDir, "pathspec.py"),
          [
            "from fnmatch import fnmatch",
            "",
            "class _Spec:",
            "    def __init__(self, patterns):",
            "        self.patterns = list(patterns)",
            "",
            "    def match_file(self, path):",
            "        return any(fnmatch(path, pattern) for pattern in self.patterns)",
            "",
            "class PathSpec:",
            "    @staticmethod",
            "    def from_lines(style, patterns):",
            "        del style",
            "        return _Spec(patterns)",
            "",
          ].join("\n"),
        );
        const runnerPath = join(pluginDir, "runner.py");
        await writeFileContent(
          runnerPath,
          [
            "import importlib.util",
            "import json",
            "from pathlib import Path",
            "",
            'plugin_path = Path(__file__).parent / "__init__.py"',
            'spec = importlib.util.spec_from_file_location("rulesync_ignore", plugin_path)',
            "plugin = importlib.util.module_from_spec(spec)",
            "spec.loader.exec_module(plugin)",
            "payload = json.dumps({",
            '    "matches_text": "allowed.txt\\n  10: client.key\\n  11: safe line\\n  123: secret\\n  1: leaked",',
            '    "total_count": 4,',
            "})",
            'print(plugin.filter_search_results("search_files", {}, payload))',
            "",
          ].join("\n"),
        );

        const { stdout } = await execFileAsync("python3", [runnerPath], {
          env: { ...process.env, PYTHONPATH: pluginDir },
        });
        const filtered = JSON.parse(stdout) as { matches_text: string; total_count: number };
        expect(filtered.matches_text).toBe("allowed.txt\n  10: client.key\n  11: safe line");
        expect(filtered.total_count).toBe(2);
      } finally {
        await cleanup();
      }
    },
  );

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
