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
import { hasPython3, runHermesPlugin } from "../../test-utils/hermes-plugin-runner.js";
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
    // A slash command has no parent agent, so delegate_task cannot be called
    // from it; the brief is queued as a user message instead (issue #3563).
    expect(plugin?.getFileContent()).not.toContain("ctx.dispatch_tool(");
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

  describe("generated plugin (python3)", () => {
    const pluginInit = (): string => {
      const init = HermesagentSubagent.fromRulesyncSubagents({ rulesyncSubagents: [] }).find(
        (file) => file.getRelativeFilePath() === "__init__.py",
      );
      if (!init) throw new Error("Hermes subagents plugin was not generated");
      return init.getFileContent();
    };
    const reviewerSpec = {
      slug: "Code_Reviewer",
      name: "Reviewer",
      description: "Review code",
      prompt: "Be careful.",
      hermes: { command: "rulesync-subagent-code-reviewer" },
    };

    test.runIf(hasPython3)(
      "queues the brief as a user message on the calling session",
      async () => {
        const { testDir, cleanup } = await setupTestDirectory();
        try {
          const run = await runHermesPlugin({
            root: testDir,
            pluginName: "rulesync-subagents",
            pluginInit: pluginInit(),
            specKind: "subagents",
            specs: { "Code_Reviewer.json": reviewerSpec },
            args: "check src/",
            handlerKwargs: { session_key: "agent:main:cli:abc" },
          });

          expect(run.commands).toEqual(["rulesync-subagent-code-reviewer"]);
          expect(run.injected).toEqual([
            {
              content:
                "Use the delegate_task tool to hand the following task to a subagent acting as " +
                "the Reviewer RuleSync subagent.\n\nGoal: Review code\n\n" +
                "Subagent instructions:\nBe careful.\n\nTask details:\ncheck src/",
              role: "user",
              kwargs: { session_key: "agent:main:cli:abc" },
            },
          ]);
          expect(run.replies["rulesync-subagent-code-reviewer"]).toBe(
            "Queued the Reviewer subagent task; the agent will delegate it.",
          );
        } finally {
          await cleanup();
        }
      },
    );

    test.runIf(hasPython3)(
      "falls back to the session context key and reports a refused injection",
      async () => {
        const { testDir, cleanup } = await setupTestDirectory();
        try {
          const run = await runHermesPlugin({
            root: testDir,
            pluginName: "rulesync-subagents",
            pluginInit: pluginInit(),
            specKind: "subagents",
            // A spec from an older Rulesync still carries the underscored name.
            specs: { "Code_Reviewer.json": { ...reviewerSpec, hermes: undefined } },
            args: "",
            injectResult: false,
            contextSessionKey: "agent:main:telegram:dm:1",
          });

          expect(run.commands).toEqual(["rulesync-subagent-code-reviewer"]);
          expect(run.injected[0]?.kwargs).toEqual({ session_key: "agent:main:telegram:dm:1" });
          expect(run.replies["rulesync-subagent-code-reviewer"]).toBe(
            "Hermes refused to queue the Reviewer subagent task: there is no active session, or this plugin " +
              "may not inject messages. In gateway sessions, set " +
              "plugins.entries.rulesync-subagents.allow_gateway_injection: true in config.yaml.",
          );
        } finally {
          await cleanup();
        }
      },
    );

    test.runIf(hasPython3)(
      "warns and keeps the first subagent when two map to the same command",
      async () => {
        const { testDir, cleanup } = await setupTestDirectory();
        try {
          const run = await runHermesPlugin({
            root: testDir,
            pluginName: "rulesync-subagents",
            pluginInit: pluginInit(),
            specKind: "subagents",
            specs: {
              // Distinct file names on case-insensitive file systems too.
              "a-reviewer.json": reviewerSpec,
              "b-reviewer.json": {
                ...reviewerSpec,
                slug: "code-reviewer",
                name: "Other",
                hermes: undefined,
              },
            },
            args: "",
            handlerKwargs: { session_key: "agent:main:cli:abc" },
          });

          expect(run.commands).toEqual(["rulesync-subagent-code-reviewer"]);
          expect(run.replies["rulesync-subagent-code-reviewer"]).toContain("Reviewer");
          expect(run.warnings).toHaveLength(1);
          expect(run.warnings[0]).toContain("both map to /rulesync-subagent-code-reviewer");
        } finally {
          await cleanup();
        }
      },
    );
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
