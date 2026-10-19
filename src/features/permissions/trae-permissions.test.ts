import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { TraePermissions } from "./trae-permissions.js";

const CONFIG_DIR = join(".trae", "permission");
const CONFIG_FILE = "global.json";

function createRulesyncPermissions(permission: Record<string, Record<string, string>>) {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
    validate: true,
  });
}

async function writeConfig(homeDir: string, config: unknown): Promise<void> {
  await ensureDir(join(homeDir, CONFIG_DIR));
  await writeFileContent(
    join(homeDir, CONFIG_DIR, CONFIG_FILE),
    typeof config === "string" ? config : JSON.stringify(config, null, 2),
  );
}

async function generate(
  homeDir: string,
  permission: Record<string, Record<string, string>>,
  logger = createMockLogger(),
): Promise<Record<string, any>> {
  const permissions = await TraePermissions.fromRulesyncPermissions({
    outputRoot: homeDir,
    rulesyncPermissions: createRulesyncPermissions(permission),
    global: true,
    logger,
  });
  return JSON.parse(permissions.getFileContent());
}

function importFrom(homeDir: string, config: unknown) {
  return new TraePermissions({
    outputRoot: homeDir,
    relativeDirPath: CONFIG_DIR,
    relativeFilePath: CONFIG_FILE,
    fileContent: JSON.stringify(config),
    global: true,
  })
    .toRulesyncPermissions()
    .getJson().permission;
}

describe("TraePermissions", () => {
  let homeDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir: homeDir, cleanup } = await setupTestDirectory({ home: true }));
    vi.spyOn(process, "cwd").mockReturnValue(homeDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("uses ~/.trae/permission/global.json and is never deletable", () => {
    expect(TraePermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: CONFIG_DIR,
      relativeFilePath: CONFIG_FILE,
    });
    expect(
      TraePermissions.forDeletion({
        outputRoot: homeDir,
        relativeDirPath: CONFIG_DIR,
        relativeFilePath: CONFIG_FILE,
      }).isDeletable(),
    ).toBe(false);
  });

  it("maps bash globs to exact, prefix and regex commandRules", async () => {
    const generated = await generate(homeDir, {
      bash: {
        "git status": "allow",
        "git add *": "allow",
        "npm * test": "allow",
        "*": "ask",
        "rm -rf *": "deny",
      },
    });

    expect(generated.customProfiles.defaultCustomProfile.approval.commandRules).toEqual({
      "git status": { approval: "allow" },
      "git add *": { approval: "allow" },
      "r/^npm .* test$/": { approval: "allow" },
      "r/^.*$/": { approval: "ask" },
      "rm -rf *": { approval: "deny" },
    });
    expect(generated.resourceAuthorization).toBeUndefined();
  });

  it("escapes regex metacharacters in a glob written as a regex", async () => {
    const generated = await generate(homeDir, { bash: { "cat *.log | grep *": "deny" } });

    expect(generated.customProfiles.defaultCustomProfile.approval.commandRules).toEqual({
      "r/^cat .*\\.log \\| grep .*$/": { approval: "deny" },
    });
  });

  it("maps MCP categories to mcpRules and skips what TRAE cannot name", async () => {
    const logger = createMockLogger();
    const generated = await generate(
      homeDir,
      {
        "mcp__github__*": { "*": "ask" },
        mcp__playwright__navigate: { "*": "allow" },
        "mcp__*": { "*": "deny" },
        mcp__fs__read: { "/etc/**": "deny" },
      },
      logger,
    );

    expect(generated.customProfiles.defaultCustomProfile.approval.mcpRules).toEqual({
      "github__*": { approval: "ask" },
      playwright__navigate: { approval: "allow" },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'mcp__*'"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'/etc/**'"));
  });

  it("maps webfetch domains to resourceAuthorization.network and skips ask and *", async () => {
    const logger = createMockLogger();
    const generated = await generate(
      homeDir,
      {
        webfetch: {
          "*.github.com:443": "allow",
          "[10.0.0.0/8]": "deny",
          "example.com": "ask",
          "*": "deny",
        },
        read: { ".env": "deny" },
      },
      logger,
    );

    expect(generated.resourceAuthorization).toEqual({
      network: { allow: ["*.github.com:443"], deny: ["[10.0.0.0/8]"] },
    });
    expect(generated.customProfiles).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'example.com'"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'webfetch' rule '*'"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("'read' category"));
  });

  it("keeps the custom permission mode and the keys rulesync does not manage", async () => {
    await writeConfig(homeDir, {
      customProfiles: {
        defaultCustomProfile: {
          shellSandbox: { enable: true },
          approval: {
            reviewer: "user",
            commandRules: {
              "git *": { approval: "ask", execEnv: "host" },
              "r/foo\\d+/": { approval: "deny" },
              stale: { approval: "allow" },
            },
            mcpRules: { "other__*": { approval: "ask" }, "github__*": { approval: "deny" } },
          },
        },
      },
      resourceAuthorization: {
        filesystem: { readOnly: ["~/secrets"] },
        network: { allow: ["kept.example.com"] },
      },
      extra: 1,
    });

    const generated = await generate(homeDir, {
      bash: { "git *": "allow" },
      "mcp__github__*": { "*": "allow" },
    });

    expect(generated).toEqual({
      customProfiles: {
        defaultCustomProfile: {
          shellSandbox: { enable: true },
          approval: {
            reviewer: "user",
            commandRules: {
              "r/foo\\d+/": { approval: "deny" },
              "git *": { approval: "allow", execEnv: "host" },
            },
            mcpRules: { "other__*": { approval: "ask" }, "github__*": { approval: "allow" } },
          },
        },
      },
      resourceAuthorization: {
        filesystem: { readOnly: ["~/secrets"] },
        network: { allow: ["kept.example.com"] },
      },
      extra: 1,
    });
  });

  it("removes the network lists when the webfetch category has no writable rules", async () => {
    await writeConfig(homeDir, {
      resourceAuthorization: { network: { allow: ["a.com"], deny: ["b.com"] } },
    });

    const generated = await generate(homeDir, { webfetch: { "c.com": "ask" } });

    expect(generated.resourceAuthorization).toEqual({ network: {} });
  });

  it("does not add owned keys when nothing is mapped", async () => {
    await writeConfig(homeDir, { other: true });

    const generated = await generate(homeDir, {});

    expect(generated).toEqual({ other: true });
  });

  it("refuses to overwrite an unparseable file", async () => {
    await writeConfig(homeDir, "{ not json");

    await expect(generate(homeDir, { bash: { "git *": "allow" } })).rejects.toThrow(
      /Failed to parse TRAE permission config/,
    );
  });

  it("imports commandRules, mcpRules and network lists back", () => {
    const permission = importFrom(homeDir, {
      customProfiles: {
        defaultCustomProfile: {
          approval: {
            commandRules: {
              "git status": { approval: "allow" },
              "git add *": { approval: "allow", execEnv: "host" },
              "r/^npm .* test$/": { approval: "ask" },
              "r/rm\\s+-rf/": { approval: "deny" },
              "a * b": { approval: "deny" },
              bad: { approval: "maybe" },
            },
            mcpRules: {
              github__create_issue: { approval: "deny" },
              "slack__*": { approval: "ask" },
              admin: { approval: "deny" },
            },
          },
        },
      },
      resourceAuthorization: {
        network: { allow: ["github.com", "both.com"], deny: ["both.com"] },
      },
    });

    expect(permission).toEqual({
      bash: { "git status": "allow", "git add *": "allow", "npm * test": "ask" },
      mcp__github__create_issue: { "*": "deny" },
      "mcp__slack__*": { "*": "ask" },
      "mcp__admin__*": { "*": "deny" },
      webfetch: { "github.com": "allow", "both.com": "deny" },
    });
  });

  it("reads the file from the home directory", async () => {
    await writeConfig(homeDir, {
      resourceAuthorization: { network: { deny: ["evil.com"] } },
    });

    const permissions = await TraePermissions.fromFile({ outputRoot: homeDir, global: true });

    expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({
      webfetch: { "evil.com": "deny" },
    });
  });
});
