import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_GLOBAL_WIN32_DIR,
  HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
} from "../../constants/hermesagent-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { getHermesagentSharedConfigWritePaths } from "../../utils/hermesagent.js";
import { parseSharedConfig } from "../shared/shared-config-gateway.js";
import { HermesagentSubagent } from "./hermesagent-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("HermesagentSubagent", () => {
  test("loads a generated subagent from its Hermes directory", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    const specDir = join(testDir, HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH);
    await mkdir(specDir, { recursive: true });
    await writeFile(
      join(specDir, "reviewer.json"),
      JSON.stringify({
        slug: "reviewer",
        name: "Reviewer",
        description: "Review code changes",
        prompt: "Review code carefully.",
      }),
      "utf8",
    );

    try {
      const subagent = await HermesagentSubagent.fromFile({
        outputRoot: testDir,
        relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
        relativeFilePath: "reviewer.json",
        global: false,
      });

      const imported = subagent.toRulesyncSubagent();
      expect(imported.getRelativePathFromCwd()).toBe(
        `${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/reviewer.md`,
      );
      expect(imported.getFilePath()).toBe(
        join(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md"),
      );
      expect(imported.getBody()).toBe("Review code carefully.");
    } finally {
      await cleanup();
    }
  });

  test("generates native Hermes delegation plugin files", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/reviewer.md`,
      frontmatter: {
        name: "Reviewer",
        description: "Review code changes",
      },
      body: "Review the code carefully.",
    });

    const files = HermesagentSubagent.fromRulesyncSubagents({
      rulesyncSubagents: [rulesyncSubagent],
    });

    expect(files.map((file) => file.getRelativeFilePath()).toSorted()).toEqual(
      [`reviewer.json`, `plugin.yaml`, `__init__.py`].toSorted(),
    );

    const subagentSpec = files.find((file) => file.getRelativeFilePath() === `reviewer.json`);
    expect(JSON.parse(subagentSpec?.getFileContent() ?? "{}")).toMatchObject({
      slug: "reviewer",
      name: "Reviewer",
      description: "Review code changes",
      prompt: "Review the code carefully.",
      hermes: {
        command: "rulesync-subagent-reviewer",
        dispatch: "inject_message",
      },
    });

    // delegate_task takes no model-facing "toolsets" argument (issue #2414),
    // so the spec must not advertise one.
    expect(subagentSpec?.getFileContent()).not.toContain("toolsets");

    const plugin = files.find((file) => file.getRelativeFilePath() === `__init__.py`);
    // Hermes' gateway looks plugin commands up with "_" turned into "-", so the
    // registered name must be hyphenated (issue #3563).
    expect(plugin?.getFileContent()).toContain(
      'return "rulesync-subagent-" + str(slug).replace("_", "-").lower()',
    );
    expect(plugin?.getFileContent()).not.toContain("rulesync_subagent_");
    // A slash command has no parent agent, so delegate_task cannot be called
    // from it; the brief is queued as a user message instead (issue #3563).
    expect(plugin?.getFileContent()).not.toContain("ctx.dispatch_tool(");
    expect(plugin?.getFileContent()).toContain(
      'ctx.inject_message(message, role="user", session_key=session_key)',
    );
    expect(plugin?.getFileContent()).toContain("Use the delegate_task tool");
    expect(plugin?.getFileContent()).toContain("ctx.register_command");
    expect(plugin?.getFileContent()).toContain(
      'Path(__file__).resolve().parents[2] / "rulesync" / "subagents"',
    );

    const manifest = files.find((file) => file.getRelativeFilePath() === `plugin.yaml`);
    expect(manifest?.getFileContent()).toContain("name: rulesync-subagents");
  });

  test("hyphenates and lowercases the Hermes command name of an underscored slug", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/Code_Reviewer.md`,
      frontmatter: { name: "Code Reviewer" },
      body: "Review the code carefully.",
    });

    const subagent = HermesagentSubagent.fromRulesyncSubagent({
      relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
      rulesyncSubagent,
    });

    expect(JSON.parse(subagent.getFileContent())).toMatchObject({
      slug: "Code_Reviewer",
      hermes: { command: "rulesync-subagent-code-reviewer" },
    });
  });

  test("declares the Hermes subagent directory as settable", () => {
    expect(HermesagentSubagent.getSettablePaths()).toEqual({
      relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
    });
  });

  test("declares per-subagent generated paths", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH}/reviewer.md`,
      frontmatter: {
        name: "Reviewer",
      },
      body: "Review the code carefully.",
    });

    expect(HermesagentSubagent.getSettablePathsForRulesyncSubagent(rulesyncSubagent)).toEqual([
      `${HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH}/reviewer.json`,
    ]);
  });

  test("uses Hermes plugin directories", () => {
    expect(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH).toBe(
      `${HERMESAGENT_GLOBAL_DIR}/plugins/rulesync-subagents`,
    );
  });

  test("preserves existing Hermes config when enabling subagents plugin", () => {
    const files = HermesagentSubagent.fromRulesyncSubagents({
      rulesyncSubagents: [],
      global: true,
    });
    const config = files.find((file) => file.getRelativeFilePath() === "config.yaml");

    config?.setFileContent(`model: hermes-3
mcp_servers:
  docs:
    url: https://example.com/mcp
plugins:
  enabled:
    - existing-plugin
`);

    const parsed = parseSharedConfig({
      format: "yaml",
      fileContent: config?.getFileContent() ?? "",
    });
    expect(parsed.model).toBe("hermes-3");
    expect(parsed.mcp_servers).toEqual({
      docs: { url: "https://example.com/mcp" },
    });
    expect(parsed.plugins).toEqual({
      enabled: ["existing-plugin", "rulesync-subagents"],
    });
    // Every spelling the global profile root can take is declared, so the
    // shared-write derivation is stable across platforms and HERMES_HOME.
    expect(HermesagentSubagent.getExtraSharedWritePaths()).toEqual(
      getHermesagentSharedConfigWritePaths(),
    );
    expect(getHermesagentSharedConfigWritePaths().map((path) => path.relativeDirPath)).toEqual([
      HERMESAGENT_GLOBAL_DIR,
      HERMESAGENT_GLOBAL_WIN32_DIR,
      ".",
    ]);
  });
});

describe("HermesagentSubagent global settable paths", () => {
  // Pinned as literals rather than re-calling getHermesagentGlobalDir(), so the
  // platform branch itself is asserted and not merely restated.
  const expectedGlobalDir =
    process.platform === "win32" ? join("AppData", "Local", "hermes") : ".hermes";

  const originalHermesHome = process.env.HERMES_HOME;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  test("anchors global paths on the platform profile directory when HERMES_HOME is unset", () => {
    delete process.env.HERMES_HOME;

    expect(HermesagentSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(expectedGlobalDir, "rulesync", "subagents"),
    });
  });

  test("drops the .hermes prefix when HERMES_HOME names the profile root itself", () => {
    process.env.HERMES_HOME = "/custom-hermes";

    expect(HermesagentSubagent.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join("rulesync", "subagents"),
    });
  });
});
