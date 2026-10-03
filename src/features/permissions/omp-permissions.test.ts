import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { loadYaml } from "../../utils/yaml.js";
import { OmpPermissions } from "./omp-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissionsFrom(config: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(config),
  });
}

function createLogger() {
  return { warn: vi.fn() };
}

describe("OmpPermissions", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should write .omp/config.yml at project scope and .omp/agent/config.yml at global scope", () => {
    expect(OmpPermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".omp",
      relativeFilePath: "config.yml",
    });
    expect(OmpPermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".omp", "agent"),
      relativeFilePath: "config.yml",
    });
  });

  it("should not be deletable because config.yml holds unrelated user settings", () => {
    const permissions = OmpPermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".omp",
      relativeFilePath: "config.yml",
    });

    expect(permissions.isDeletable()).toBe(false);
  });

  it("should map catch-all rules to tools.approval and bash rules to ordered bash.patterns", async () => {
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {
          bash: { "git *": "allow", "git push *": "ask", "rm -rf *": "deny", "*": "allow" },
          read: { "*": "allow" },
          edit: { "*": "ask" },
          websearch: { "*": "deny" },
          agent: { "*": "ask" },
        },
      }),
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: {
        approval: {
          // An ask rule makes the bash policy prompt, and the catch-all allow
          // becomes a trailing pattern.
          bash: "prompt",
          read: "allow",
          edit: "prompt",
          web_search: "deny",
          task: "prompt",
        },
      },
      bash: {
        patterns: [
          { match: "rm -rf *", approval: "deny" },
          { match: "git push *", approval: "prompt" },
          { match: "git *", approval: "allow" },
          { match: "*", approval: "allow" },
        ],
      },
    });
  });

  it("should write a bash catch-all ask or deny as a pattern so it shadows narrower allows", async () => {
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: { bash: { "git status": "allow", "*": "ask" } },
      }),
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: { approval: { bash: "prompt" } },
      bash: {
        patterns: [
          { match: "*", approval: "prompt" },
          { match: "git status", approval: "allow" },
        ],
      },
    });
  });

  it("should keep unrelated settings and unmanaged approval keys while replacing managed ones", async () => {
    await writeFileContent(
      join(testDir, ".omp", "config.yml"),
      [
        "theme:",
        "  dark: titanium",
        "tools:",
        "  approvalMode: write",
        "  approval:",
        "    read: deny",
        "    eval: prompt",
        "bash:",
        "  enabled: true",
        "  patterns:",
        "    - match: old *",
        "      approval: allow",
        "",
      ].join("\n"),
    );

    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: { edit: { "*": "allow" } },
      }),
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      theme: { dark: "titanium" },
      tools: { approvalMode: "write", approval: { eval: "prompt", edit: "allow" } },
      bash: { enabled: true },
    });
  });

  it("should remove emptied tools and bash blocks", async () => {
    await writeFileContent(
      join(testDir, ".omp", "config.yml"),
      ["tools:", "  approval:", "    bash: allow", "theme:", "  dark: titanium", ""].join("\n"),
    );

    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: {} }),
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({ theme: { dark: "titanium" } });
  });

  it("should collapse pattern-specific non-bash rules to one policy with a warning", async () => {
    const logger = createLogger();
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {
          read: { "*": "allow", ".env": "deny" },
          write: { "src/**": "allow" },
        },
      }),
      logger: logger as never,
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: { approval: { read: "deny", write: "prompt" } },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"read" rules'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"write" rules'));
  });

  it("should skip categories oh-my-pi has no tool for and honor all-tools restrictions on bash", async () => {
    const logger = createLogger();
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {
          "*": { "npm publish *": "deny" },
          bash: { "npm *": "allow" },
          webfetch: { "*": "allow" },
          notebookedit: { "*": "deny" },
          mcp__github__create_issue: { "*": "deny" },
        },
      }),
      logger: logger as never,
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: {
        // A pattern-specific all-tools deny makes every other tool prompt.
        approval: {
          mcp__github__create_issue: "deny",
          read: "prompt",
          edit: "prompt",
          write: "prompt",
          grep: "prompt",
          glob: "prompt",
          web_search: "prompt",
          task: "prompt",
        },
      },
      bash: {
        // A bash allow that an all-tools restriction overlaps is withheld.
        patterns: [{ match: "npm publish *", approval: "deny" }],
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"webfetch"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"notebookedit"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"*" category'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("mcp__<server>_<tool>"));
  });

  it("should apply an all-tools catch-all deny to every tool even without a bash category", async () => {
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: { "*": { "*": "deny" }, read: { "*": "allow" }, eval: { "*": "allow" } },
      }),
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: {
        approval: {
          read: "deny",
          eval: "deny",
          edit: "deny",
          write: "deny",
          grep: "deny",
          glob: "deny",
          web_search: "deny",
          task: "deny",
        },
      },
      bash: { patterns: [{ match: "*", approval: "deny" }] },
    });
  });

  it("should raise kept unmanaged approval keys to an all-tools restriction", async () => {
    await writeFileContent(
      join(testDir, ".omp", "config.yml"),
      ["tools:", "  approval:", "    eval: allow", "    mcp__x_y: deny", ""].join("\n"),
    );

    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: { "*": { "*": "ask" } } }),
    });

    expect(loadYaml(permissions.getFileContent())).toMatchObject({
      tools: { approval: { eval: "prompt", mcp__x_y: "deny", read: "prompt" } },
      bash: { patterns: [{ match: "*", approval: "prompt" }] },
    });
  });

  it("should write the stricter policy when agent and task share the task key", async () => {
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: { task: { "*": "deny" }, agent: { "*": "allow" } },
      }),
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: { approval: { task: "deny" } },
    });
  });

  it("should widen ? and [...] in bash deny and ask patterns and keep them literal in allow", async () => {
    const logger = createLogger();
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {
          bash: {
            "ls ?": "allow",
            "rm -r? *": "deny",
            "git [pP]ush *": "ask",
            "mv []a] *": "deny",
            "cp [": "deny",
          },
        },
      }),
      logger: logger as never,
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: { approval: { bash: "prompt" } },
      bash: {
        patterns: [
          { match: "rm -r* *", approval: "deny" },
          { match: "mv * *", approval: "deny" },
          { match: "cp *", approval: "deny" },
          { match: "git *ush *", approval: "prompt" },
          { match: "ls ?", approval: "allow" },
        ],
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"ls ?"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"rm -r? *"'));
  });

  it("should write the tool-scoped omp block over the shared one", async () => {
    const rulesyncPermissions = rulesyncPermissionsFrom({
      permission: { read: { "*": "allow" } },
      omp: { permission: { read: { "*": "deny" }, eval: { "*": "prompt" } } },
    }).forTarget({ toolTarget: "omp" });

    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(loadYaml(permissions.getFileContent())).toMatchObject({
      tools: { approval: { read: "deny" } },
    });
  });

  it("should refuse to rewrite a config.yml whose root is not a mapping", async () => {
    await writeFileContent(join(testDir, ".omp", "config.yml"), "- not a mapping\n");

    await expect(
      OmpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissionsFrom({ permission: { read: { "*": "allow" } } }),
      }),
    ).rejects.toThrow();
  });

  it("should import tools.approval and bash.patterns into canonical rules", async () => {
    await writeFileContent(
      join(testDir, ".omp", "agent", "config.yml"),
      [
        "tools:",
        "  approvalMode: write",
        "  approval:",
        "    bash: Prompt",
        "    web_search: deny",
        "    task: allow",
        "    agent: deny",
        "    eval: prompt",
        "    read: bogus",
        "bash:",
        "  patterns:",
        "    - match: '  git   status '",
        "      approval: allow",
        "    - match: git status",
        "      approval: deny",
        "    - match: rm -rf *",
        "      approval: deny",
        "    - match: '*'",
        "      approval: allow",
        "",
      ].join("\n"),
    );

    const permissions = await OmpPermissions.fromFile({ outputRoot: testDir, global: true });
    const json = permissions.toRulesyncPermissions().getJson();

    expect(json.permission).toEqual({
      // A `prompt` policy behind a lone `*` allow pattern stays `ask`.
      // Whitespace runs collapse, and the later duplicate is never consulted.
      bash: { "git status": "allow", "rm -rf *": "deny", "*": "ask" },
      websearch: { "*": "deny" },
      // A verbatim `agent` key and `task` import to one category; the stricter wins.
      agent: { "*": "deny" },
      eval: { "*": "ask" },
    });
  });

  it("should keep a prompt bash policy so a critical command cannot skip an ask rule", async () => {
    const logger = createLogger();
    const source = { bash: { "*": "allow", "rm *": "ask" } };
    const permissions = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: source }),
      logger: logger as never,
    });

    expect(loadYaml(permissions.getFileContent())).toEqual({
      tools: { approval: { bash: "prompt" } },
      bash: {
        patterns: [
          { match: "rm *", approval: "prompt" },
          { match: "*", approval: "allow" },
        ],
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("critical command"));
    expect(permissions.toRulesyncPermissions().getJson().permission).toEqual(source);
  });

  it("should keep a hand-written prompt bash policy behind a lone * allow pattern as ask", async () => {
    await writeFileContent(
      join(testDir, ".omp", "config.yml"),
      [
        "tools:",
        "  approval:",
        "    bash: prompt",
        "bash:",
        "  patterns:",
        "    - match: git status",
        "      approval: allow",
        "    - match: '*'",
        "      approval: allow",
        "",
      ].join("\n"),
    );

    const permissions = await OmpPermissions.fromFile({ outputRoot: testDir });

    expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
      bash: { "git status": "allow", "*": "ask" },
    });
  });

  it("should round-trip ask-only bash rules without adding a catch-all", async () => {
    const source = { bash: { "git push *": "ask", "git *": "allow" } };
    const generated = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: source }),
    });

    expect(generated.toRulesyncPermissions().getJson().permission).toEqual(source);
  });

  it("should import a tools.approval.bash deny over a * allow pattern", async () => {
    await writeFileContent(
      join(testDir, ".omp", "config.yml"),
      [
        "tools:",
        "  approval:",
        "    bash: deny",
        "bash:",
        "  patterns:",
        "    - match: '*'",
        "      approval: allow",
        "",
      ].join("\n"),
    );

    const permissions = await OmpPermissions.fromFile({ outputRoot: testDir });

    expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
      bash: { "*": "deny" },
    });
  });

  it("should round-trip generated output back to the same canonical rules", async () => {
    const source = {
      bash: { "rm -rf *": "deny", "git *": "allow", "*": "allow" },
      read: { "*": "allow" },
      agent: { "*": "ask" },
    };
    const generated = await OmpPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: source }),
    });

    const imported = new OmpPermissions({
      outputRoot: testDir,
      relativeDirPath: ".omp",
      relativeFilePath: "config.yml",
      fileContent: generated.getFileContent(),
    })
      .toRulesyncPermissions()
      .getJson();

    expect(imported.permission).toEqual(source);
  });
});
