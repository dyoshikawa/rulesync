import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { writeFileContent } from "../../utils/file.js";
import { AntigravityCliPermissions } from "./antigravity-cli-permissions.js";
import { AntigravityIdePermissions } from "./antigravity-ide-permissions.js";
import { AugmentcodePermissions } from "./augmentcode-permissions.js";
import { CodebuddyPermissions } from "./codebuddy-permissions.js";
import { CodexcliPermissions } from "./codexcli-permissions.js";
import { CommandcodePermissions } from "./commandcode-permissions.js";
import { ContinuePermissions } from "./continue-permissions.js";
import { CopilotPermissions } from "./copilot-permissions.js";
import { CopilotcliPermissions } from "./copilotcli-permissions.js";
import { CrushPermissions } from "./crush-permissions.js";
import { CursorPermissions } from "./cursor-permissions.js";
import { DevinPermissions } from "./devin-permissions.js";
import { GrokcliPermissions } from "./grokcli-permissions.js";
import { JuniePermissions } from "./junie-permissions.js";
import { KiloPermissions } from "./kilo-permissions.js";
import { KimiCodePermissions } from "./kimi-code-permissions.js";
import { KiroCapabilityPermissions } from "./kiro-capability-permissions.js";
import { LettacodePermissions } from "./lettacode-permissions.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { PoolPermissions } from "./pool-permissions.js";
import { QoderPermissions } from "./qoder-permissions.js";
import { QwencodePermissions } from "./qwencode-permissions.js";
import { ReasonixPermissions } from "./reasonix-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  honorAllToolsRestrictions,
  urlPatternsOverlap,
  withholdAllowsShadowedByAsks,
} from "./shadowed-allows.js";
import { TaktPermissions } from "./takt-permissions.js";
import { TraePermissions } from "./trae-permissions.js";
import { VibePermissions } from "./vibe-permissions.js";

type Generator = {
  fromRulesyncPermissions: (params: {
    outputRoot: string;
    rulesyncPermissions: RulesyncPermissions;
    global?: boolean;
    logger?: ReturnType<typeof createMockLogger>;
  }) => Promise<{ getFileContent: () => string }> | { getFileContent: () => string };
};

describe("honorAllToolsRestrictions", () => {
  it("withholds every allow a '*' deny or ask covers and copies them onto bash", () => {
    const logger = createMockLogger();
    const result = honorAllToolsRestrictions({
      permission: {
        "*": { ".env": "deny", "git push *": "ask" },
        read: { "*": "allow", "src/**": "allow" },
        bash: { "git *": "allow", "ls *": "allow" },
      },
      toolLabel: "Tool",
      logger,
    });

    expect(result.read).toEqual({ "src/**": "allow" });
    expect(result.bash).toEqual({ "ls *": "allow", ".env": "deny", "git push *": "ask" });
    expect(result["*"]).toEqual({ ".env": "deny", "git push *": "ask" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("read: *, bash: git *"));
  });

  it("leaves a natively written '*' catch-all out of the withholding", () => {
    const result = honorAllToolsRestrictions({
      permission: { "*": { "*": "ask" }, read: { "*": "allow" } },
      toolLabel: "Tool",
      writesAllToolsCatchAll: true,
    });

    expect(result.read).toEqual({ "*": "allow" });
  });

  it("reads a '**/' segment as zero or more directories on either side", () => {
    const denyWithGlobstar = honorAllToolsRestrictions({
      permission: { "*": { "**/.env": "deny" }, read: { ".env": "allow" } },
      toolLabel: "Tool",
    });
    expect(denyWithGlobstar.read).toEqual({});

    const allowWithGlobstar = honorAllToolsRestrictions({
      permission: { "*": { ".env": "deny" }, read: { "**/*": "allow", "src/**": "allow" } },
      toolLabel: "Tool",
    });
    expect(allowWithGlobstar.read).toEqual({ "src/**": "allow" });

    const trailingGlobstar = honorAllToolsRestrictions({
      permission: { "*": { "secrets/**": "deny" }, read: { secrets: "allow" } },
      toolLabel: "Tool",
    });
    expect(trailingGlobstar.read).toEqual({});
  });

  it("reads a trailing ' *' as optional and a brace alternation as overlapping everything", () => {
    const result = honorAllToolsRestrictions({
      permission: {
        "*": { secrets: "deny", "{a,b}.env": "ask" },
        bash: { "secrets *": "allow" },
        read: { "src/**": "allow" },
      },
      toolLabel: "Tool",
    });

    expect(result.bash?.["secrets *"]).toBeUndefined();
    expect(result.read).toEqual({});
  });

  it("compares webfetch patterns case-insensitively and without their scheme", () => {
    const result = honorAllToolsRestrictions({
      permission: {
        "*": { "HTTPS://Evil.example/*": "deny" },
        webfetch: { "evil.example/*": "allow", "good.example/*": "allow" },
      },
      toolLabel: "Tool",
    });

    expect(result.webfetch).toEqual({ "good.example/*": "allow" });
  });

  it("keeps a host allow that only command and path restrictions sit beside", () => {
    const result = honorAllToolsRestrictions({
      permission: {
        "*": { "rm -rf *": "deny", ".env": "deny", "git push *": "ask" },
        webfetch: { "github.com": "allow", "*.example.com": "allow" },
      },
      toolLabel: "Tool",
    });

    expect(result.webfetch).toEqual({ "github.com": "allow", "*.example.com": "allow" });
  });

  it("names a bash allow replaced by a '*' ask of the same spelling", () => {
    const logger = createMockLogger();
    const result = honorAllToolsRestrictions({
      permission: { "*": { "git push *": "ask" }, bash: { "git push *": "allow" } },
      toolLabel: "Tool",
      logger,
    });

    expect(result.bash).toEqual({ "git push *": "ask" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bash: git push *"));
  });

  it("drops pattern-specific '*' entries but keeps the catch-all when asked to", () => {
    const result = honorAllToolsRestrictions({
      permission: { "*": { "*": "ask", ".env": "deny" } },
      toolLabel: "Tool",
      dropAllToolsPatterns: true,
    });

    expect(result["*"]).toEqual({ "*": "ask" });
  });
});

describe("urlPatternsOverlap", () => {
  it.each([
    ["evil.example", "https://evil.example/*"],
    ["gist.github.com", "https://*.github.com/*"],
    ["https://upload.example.com/*", "upload.example.com"],
    ["http://localhost:*/*", "localhost"],
    ["*evil*", "Evil.com"],
    ["*", "github.com"],
  ])("%s overlaps %s", (left, right) => {
    expect(urlPatternsOverlap(left, right)).toBe(true);
  });

  it.each([
    ["rm -rf *", "github.com"],
    [".env", "github.com"],
    ["example.org/private/*", "*.github.com"],
    ["example.com", "*.github.com:443"],
    ["github.com:80", "github.com:443"],
    ["example.com/a/*", "example.com/b/*"],
  ])("%s does not overlap %s", (left, right) => {
    expect(urlPatternsOverlap(left, right)).toBe(false);
  });
});

describe("withholdAllowsShadowedByAsks", () => {
  it("drops a covered pattern allow and downgrades a covered catch-all allow to ask", () => {
    const logger = createMockLogger();
    const result = withholdAllowsShadowedByAsks({
      permission: {
        bash: { "*": "allow", "git *": "allow", "ls *": "allow", "git push *": "ask" },
        read: { "*": "allow" },
      },
      toolLabel: "Tool",
      logger,
    });

    expect(result.bash).toEqual({ "*": "ask", "ls *": "allow", "git push *": "ask" });
    expect(result.read).toEqual({ "*": "allow" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bash: *, bash: git *"));
  });

  it("compares webfetch domains case-insensitively and without their scheme", () => {
    const result = withholdAllowsShadowedByAsks({
      permission: {
        webfetch: { "paste.example.com": "allow", "https://PASTE.example.com": "ask" },
      },
      toolLabel: "Tool",
    });

    expect(result.webfetch).toEqual({ "https://PASTE.example.com": "ask" });
  });

  it("compares the categories of one group together", () => {
    const result = withholdAllowsShadowedByAsks({
      permission: { edit: { "**": "allow" }, write: { ".env": "ask" } },
      toolLabel: "Tool",
      groupOf: (category) => (category === "write" ? "edit" : category),
    });

    expect(result.edit).toEqual({});
  });
});

describe("translators never leave an allow that covers a restriction they cannot write", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    vi.stubEnv("HOME_DIR", testDir);
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const generate = async ({
    generator,
    permission,
    global = false,
  }: {
    generator: Generator;
    permission: PermissionsConfig["permission"];
    global?: boolean;
  }): Promise<string> => {
    const file = await generator.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission }),
      }),
      global,
      logger: createMockLogger(),
    });
    return file.getFileContent();
  };

  describe("a skipped ask withholds the allows it covers", () => {
    it("Cursor CLI", async () => {
      const content = await generate({
        generator: CursorPermissions,
        permission: { write: { "**": "allow", ".github/workflows/**": "ask" } },
      });
      expect(content).not.toContain("Write(**)");
      const shell = await generate({
        generator: CursorPermissions,
        permission: { bash: { "git *": "allow", "git push *": "ask" } },
      });
      expect(shell).not.toContain("Shell(git *)");
    });

    it("Vibe falls back to permission = ask instead of always", async () => {
      const content = await generate({
        generator: VibePermissions,
        permission: { bash: { "*": "allow", "git push *": "ask" } },
      });
      expect(content).not.toContain('"always"');
      expect(content).toContain('permission = "ask"');
      const patterns = await generate({
        generator: VibePermissions,
        permission: { bash: { "git *": "allow", "git push *": "ask" } },
      });
      expect(patterns).not.toContain("git *");
    });

    it("Takt keeps readonly when an ask sits beside a bash allow", async () => {
      const content = await generate({
        generator: TaktPermissions,
        permission: { bash: { "git *": "allow", "git push *": "ask" } },
      });
      expect(content).toContain("default_permission_mode: readonly");
      const allTools = await generate({
        generator: TaktPermissions,
        permission: { "*": { "*": "ask" }, bash: { "ls *": "allow" } },
      });
      expect(allTools).toContain("default_permission_mode: readonly");
    });

    it("Codex CLI network domains", async () => {
      const content = await generate({
        generator: CodexcliPermissions,
        permission: { webfetch: { "*": "allow", "paste.example.com": "ask" } },
      });
      expect(content).not.toMatch(/"\*" = "allow"/);
    });

    it("TRAE network lists", async () => {
      const content = await generate({
        generator: TraePermissions,
        permission: { webfetch: { "*.example.com": "allow", "upload.example.com": "ask" } },
        global: true,
      });
      expect(content).not.toContain("*.example.com");
    });

    it("Copilot CLI allowedUrls", async () => {
      const content = await generate({
        generator: CopilotcliPermissions,
        permission: { webfetch: { "*": "allow", "evil.example": "ask" } },
        global: true,
      });
      expect(content).not.toContain("allowedUrls");
    });
  });

  describe("a '*' deny or ask withholds the allows it covers in every category", () => {
    const envDeny: PermissionsConfig["permission"] = {
      "*": { ".env": "deny" },
      read: { "*": "allow" },
      edit: { "*": "allow" },
    };

    it.each([
      ["Reasonix", ReasonixPermissions, false],
      ["Qwen Code", QwencodePermissions, false],
      ["Devin", DevinPermissions, false],
      ["Antigravity CLI", AntigravityCliPermissions, true],
      ["Antigravity IDE", AntigravityIdePermissions, false],
    ] as const)(
      "%s writes no catch-all allow and keeps the *(...) entry main wrote",
      async (_, generator, global) => {
        const content = await generate({ generator, permission: envDeny, global });
        expect(content).toContain("*(.env)");
        expect(content).not.toMatch(/"(Read|read_file|Edit|write_file|Write)"/);
      },
    );

    it("Reasonix and Qwen Code honor a '*' command deny on bash", async () => {
      for (const generator of [ReasonixPermissions, QwencodePermissions]) {
        const content = await generate({
          generator,
          permission: { "*": { "rm *": "deny" }, bash: { "*": "allow" } },
        });
        expect(content).toContain("Bash(rm *)");
        expect(content).not.toMatch(/"Bash"/);
        expect(content).toContain("*(rm *)");
      }
    });

    it("Kimi Code honors a '*' command deny on bash", async () => {
      const content = await generate({
        generator: KimiCodePermissions,
        permission: { "*": { "rm *": "deny" }, bash: { "*": "allow" } },
        global: true,
      });
      expect(content).toContain('pattern = "Bash(rm *)"');
      expect(content).not.toContain('decision = "allow"');
    });

    it("Junie and Pool withhold the read allow", async () => {
      const junie = await generate({
        generator: JuniePermissions,
        permission: envDeny,
        global: true,
      });
      expect(junie).not.toContain('"allow"');
      const pool = await generate({
        generator: PoolPermissions,
        permission: { "*": { "secrets/**": "deny" }, read: { "**": "allow" } },
      });
      expect(pool).not.toContain("**");
    });

    it("Copilot CLI withholds the allowedUrls catch-all", async () => {
      const content = await generate({
        generator: CopilotcliPermissions,
        permission: { "*": { "https://evil.example/*": "deny" }, webfetch: { "*": "allow" } },
        global: true,
      });
      expect(content).not.toContain("allowedUrls");
    });

    it("OpenCode restates the '*' deny after the read allow that would override it", async () => {
      const content = await generate({
        generator: OpencodePermissions,
        permission: { "*": { ".env": "deny" }, read: { "*": "allow" } },
      });
      const rules = JSON.parse(content).permissions as Array<Record<string, string>>;
      expect(rules.at(-1)).toEqual({ action: "read", resource: ".env", effect: "deny" });
    });

    const openCodeReadRules = async (
      permission: PermissionsConfig["permission"],
    ): Promise<Array<[string, string]>> => {
      const content = await generate({ generator: OpencodePermissions, permission });
      return (JSON.parse(content).permissions as Array<Record<string, string>>)
        .filter(({ action }) => action === "read")
        .map(({ resource, effect }) => [resource ?? "", effect ?? ""]);
    };

    it("OpenCode never restates a '*' ask after an overlapping deny", async () => {
      expect(
        await openCodeReadRules({
          "*": { ".env": "ask" },
          read: { "*": "allow", ".env*": "deny" },
        }),
      ).toEqual([
        ["*", "allow"],
        [".env", "ask"],
        [".env*", "deny"],
      ]);
    });

    it("OpenCode restates a '*' deny after an overlapping ask, not only an allow", async () => {
      expect(await openCodeReadRules({ "*": { ".env": "deny" }, read: { "*": "ask" } })).toEqual([
        ["*", "ask"],
        [".env", "deny"],
      ]);
    });

    it("OpenCode restates a '*' ask as a deny under a key whose own catch-all denies", async () => {
      expect(
        await openCodeReadRules({
          "*": { ".env": "ask" },
          read: { "*": "deny", "*.env": "allow" },
        }),
      ).toEqual([
        ["*", "deny"],
        ["*.env", "allow"],
        [".env", "deny"],
      ]);
    });

    it("OpenCode restates a '*' deny that a restated '*' ask overlaps", async () => {
      expect(
        await openCodeReadRules({
          "*": { "src/secret": "deny", "src/*": "ask" },
          read: { "*.ts": "allow" },
        }),
      ).toEqual([
        ["*.ts", "allow"],
        ["src/*", "ask"],
        ["src/secret", "deny"],
      ]);
    });

    it("Antigravity reads '**/' as zero or more directories on either side", async () => {
      const cases: PermissionsConfig["permission"][] = [
        { "*": { "**/.env": "deny" }, read: { ".env": "allow" } },
        { "*": { ".env": "deny" }, read: { "**/*": "allow" } },
      ];
      for (const permission of cases) {
        const content = await generate({
          generator: AntigravityCliPermissions,
          permission,
          global: true,
        });
        expect(content).not.toContain("read_file");
      }
    });

    it("Vibe writes a withheld read_file catch-all as ask and the '*' deny into its denylist", async () => {
      const content = await generate({ generator: VibePermissions, permission: envDeny });
      expect(content).not.toContain('"always"');
      expect(content).toContain('[tools.read_file]\npermission = "ask"\ndenylist = [ ".env" ]');
    });

    it("Vibe replaces a stale always and allowlist entry left by the withheld allow", async () => {
      await writeFileContent(
        join(testDir, ".vibe", "config.toml"),
        '[tools.read_file]\npermission = "always"\nallowlist = ["src/**"]\n',
      );
      const catchAll = await generate({ generator: VibePermissions, permission: envDeny });
      expect(catchAll).not.toContain('"always"');
      await writeFileContent(
        join(testDir, ".vibe", "config.toml"),
        '[tools.read_file]\npermission = "always"\nallowlist = ["src/**"]\n',
      );
      const pattern = await generate({
        generator: VibePermissions,
        permission: { "*": { "**/.env": "deny" }, read: { "src/**": "allow" } },
      });
      expect(pattern).not.toContain('"always"');
      expect(pattern).not.toContain("allowlist");
    });

    it("Kilo restates the '*' deny after the read allow that would override it", async () => {
      const content = await generate({
        generator: KiloPermissions,
        permission: { "*": { "**/.env": "deny" }, read: { "*": "allow" } },
      });
      const read = Object.entries(JSON.parse(content).permission.read as Record<string, string>);
      expect(read.at(-1)).toEqual(["**/.env", "deny"]);
    });

    it("OpenCode moves an own deny that absorbs a '*' ask below the allow after it", async () => {
      expect(
        await openCodeReadRules({
          "*": { ".env": "ask" },
          read: { ".env": "deny", "*": "allow" },
        }),
      ).toEqual([
        ["*", "allow"],
        [".env", "deny"],
      ]);
    });

    it("OpenCode reads a trailing ' *' as optional when restating", async () => {
      expect(
        await openCodeReadRules({
          "*": { secrets: "ask" },
          read: { "*": "allow", "secrets *": "deny" },
        }),
      ).toEqual([
        ["*", "allow"],
        ["secrets", "ask"],
        ["secrets *", "deny"],
      ]);
    });

    it.each([
      { read: { ".": "allow", "./**": "allow", "**/.env": "deny" } },
      { "*": { "**/.env": "deny" }, read: { src: "allow" } },
      { bash: { "git push": "allow", "* --force": "deny" } },
      { webfetch: { localhost: "allow", "http://localhost:*/*": "deny" } },
      { webfetch: { "https://Evil.com/x": "allow", "*evil*": "deny" } },
    ] as PermissionsConfig["permission"][])(
      "Antigravity compares what the emitted target grants: %j",
      async (permission) => {
        const content = await generate({
          generator: AntigravityCliPermissions,
          permission,
          global: true,
        });
        expect(JSON.parse(content).permissions.allow).toBeUndefined();
      },
    );

    it("Antigravity still writes allows no restriction covers", async () => {
      const content = await generate({
        generator: AntigravityCliPermissions,
        permission: { read: { src: "allow" }, bash: { "git status": "allow" } },
        global: true,
      });
      expect(JSON.parse(content).permissions.allow).toEqual([
        "command(git status)",
        "read_file(src)",
      ]);
    });

    it("Codex CLI and TRAE withhold a host allow a URL-path restriction covers", async () => {
      for (const permission of [
        {
          "*": { "https://upload.example.com/*": "deny" },
          webfetch: { "upload.example.com": "allow" },
        },
        { webfetch: { "example.com": "allow", "https://example.com/upload/*": "ask" } },
      ] as PermissionsConfig["permission"][]) {
        const codex = await generate({ generator: CodexcliPermissions, permission });
        expect(codex).not.toMatch(/example\.com" = "allow"/);
        const trae = await generate({ generator: TraePermissions, permission, global: true });
        expect(trae).not.toContain('"allow": [');
      }
    });

    it("Codex CLI writes a '*' path deny into its filesystem rules", async () => {
      const content = await generate({
        generator: CodexcliPermissions,
        permission: {
          "*": { "**/.env": "deny", "git push *": "deny" },
          edit: { "src/**": "allow" },
        },
      });
      expect(content).toContain('"**/.env" = "deny"');
      expect(content).not.toContain("git push");
    });

    it("Copilot (VS Code) writes the '*' restrictions as false entries", async () => {
      const content = await generate({
        generator: CopilotPermissions,
        permission: {
          "*": { "**/.env": "deny", "rm *": "deny" },
          edit: { "*": "allow" },
          bash: { "*": "allow" },
        },
      });
      const settings = JSON.parse(content) as Record<string, Record<string, boolean>>;
      // `**/.env` is written as a `false` entry; `rm *` cannot be, so it
      // withholds the `true` catch-all it overlaps.
      expect(Object.entries(settings["chat.tools.edits.autoApprove"] ?? {})).toEqual([
        ["**/.env", false],
      ]);
      expect(settings["chat.tools.terminal.autoApprove"]?.["rm *"]).toBe(false);
      expect(settings["chat.tools.terminal.autoApprove"]?.["*"]).toBeUndefined();
    });

    it("TRAE and Codex CLI withhold the network allow a '*' restriction covers", async () => {
      const permission: PermissionsConfig["permission"] = {
        "*": { "upload.example.com": "ask" },
        webfetch: { "*.example.com": "allow" },
      };
      const trae = await generate({ generator: TraePermissions, permission, global: true });
      expect(trae).not.toContain("*.example.com");
      const codex = await generate({ generator: CodexcliPermissions, permission });
      expect(codex).not.toContain("*.example.com");
    });

    it("Crush keeps the covered tools out of allowed_tools", async () => {
      const content = await generate({ generator: CrushPermissions, permission: envDeny });
      expect(content).not.toContain("allowed_tools");
    });

    it.each([
      ["Continue", ContinuePermissions, true],
      ["Grok CLI", GrokcliPermissions, false],
      ["Kiro permissions.yaml", KiroCapabilityPermissions, true],
    ] as const)("%s writes no allow for the covered categories", async (_, generator, global) => {
      const baseline = await generate({
        generator,
        permission: { read: { "*": "allow" }, edit: { "*": "allow" } },
        global,
      });
      expect(baseline).toMatch(/Read|fs_read/);
      const content = await generate({ generator, permission: envDeny, global });
      expect(content).not.toMatch(/Read|Edit|fs_read|fs_write/);
    });

    it.each([
      ["CodeBuddy", CodebuddyPermissions, "ask"],
      ["Qoder", QoderPermissions, "ask"],
      ["Command Code", CommandcodePermissions, "ask"],
      ["Letta Code", LettacodePermissions, "alwaysAsk"],
      ["Qwen Code", QwencodePermissions, "ask"],
    ] as const)(
      "%s writes the '*' path deny and ask as Read rules instead of falling back to its default",
      async (_, generator, askKey) => {
        const content = await generate({
          generator,
          permission: { "*": { ".env": "deny", "secrets/**": "ask" }, read: { "*": "allow" } },
        });
        const lists = JSON.parse(content).permissions as Record<string, string[]>;
        expect(lists.deny).toContain("Read(.env)");
        expect(lists[askKey]).toContain("Read(secrets/**)");
        expect(lists.allow ?? []).not.toContain("Read");
      },
    );

    it("Codex CLI keeps a host allow that only unrelated restrictions sit beside", async () => {
      for (const permission of [
        { "*": { "rm -rf *": "deny", ".env": "deny" }, webfetch: { "github.com": "allow" } },
        { webfetch: { "github.com": "allow", "example.org/private/*": "ask" } },
        { webfetch: { "*.github.com:443": "allow", "example.com": "ask" } },
      ] as PermissionsConfig["permission"][]) {
        const codex = await generate({ generator: CodexcliPermissions, permission });
        expect(codex).toMatch(/github\.com(:443)?" = "allow"/);
      }
    });

    it("compares a pathless restriction as every URL on its host", async () => {
      for (const permission of [
        { "*": { "evil.example": "deny" }, webfetch: { "https://evil.example/*": "allow" } },
        { webfetch: { "https://*.github.com/*": "allow", "gist.github.com": "ask" } },
      ] as PermissionsConfig["permission"][]) {
        const codex = await generate({ generator: CodexcliPermissions, permission });
        expect(codex).not.toContain('= "allow"');
        const trae = await generate({ generator: TraePermissions, permission, global: true });
        expect(trae).not.toContain('"allow": [');
      }
    });

    it("Codex CLI denies a narrower write allow a '*' ask covers, like a direct read ask", async () => {
      const covered = await generate({
        generator: CodexcliPermissions,
        permission: { "*": { "docs/**": "ask" }, edit: { "docs/x.md": "allow" } },
      });
      expect(covered).toContain('"docs/x.md" = "deny"');
      const readable = await generate({
        generator: CodexcliPermissions,
        permission: { "*": { "secret/**": "ask" }, read: { "*": "allow" } },
      });
      expect(readable).toContain('"secret/**" = "deny"');
      const catchAll = await generate({
        generator: CodexcliPermissions,
        permission: { "*": { "*": "deny" }, edit: { "src/**": "allow" } },
      });
      expect(catchAll).not.toContain('"src/**" = "write"');
    });

    it("Copilot (VS Code) writes a '*' catch-all restriction where it wins", async () => {
      const content = await generate({
        generator: CopilotPermissions,
        permission: {
          "*": { "*": "deny" },
          edit: { "src/**": "allow", "*": "allow" },
          webfetch: { "*": "allow" },
        },
      });
      const settings = JSON.parse(content) as Record<string, Record<string, boolean>>;
      expect(Object.entries(settings["chat.tools.edits.autoApprove"] ?? {}).at(-1)).toEqual([
        "*",
        false,
      ]);
      expect(Object.entries(settings["chat.tools.urls.autoApprove"] ?? {})[0]).toEqual([
        "*",
        false,
      ]);
    });

    it("Copilot (VS Code) restates a URL lowercased and without its scheme", async () => {
      const content = await generate({
        generator: CopilotPermissions,
        permission: {
          "*": { "HTTPS://Evil.example/*": "deny" },
          webfetch: { "good.example": "allow" },
        },
      });
      const settings = JSON.parse(content) as Record<string, Record<string, boolean>>;
      expect(settings["chat.tools.urls.autoApprove"]).toEqual({
        "evil.example/*": false,
        "good.example": true,
      });
    });

    it("Vibe writes a withheld catch-all as never under a '*' catch-all deny", async () => {
      const content = await generate({
        generator: VibePermissions,
        permission: { "*": { "*": "deny" }, read: { "*": "allow" } },
      });
      expect(content).toContain('permission = "never"');
      expect(content).not.toContain('permission = "ask"');
    });

    it("Vibe retires on-disk allowlist entries a current restriction covers", async () => {
      await writeFileContent(
        join(testDir, ".vibe", "config.toml"),
        '[tools.bash]\nallowlist = ["git push *", "git *", "ls"]\n',
      );
      const content = await generate({
        generator: VibePermissions,
        permission: { bash: { "git push *": "ask" } },
      });
      expect(content).toContain('allowlist = [ "ls" ]');
    });

    it("AugmentCode falls back to ask-user when the shadowing '*' restriction is only an ask", async () => {
      const content = await generate({
        generator: AugmentcodePermissions,
        permission: { "*": { ".env": "ask" }, read: { "*": "allow" } },
      });
      const entries = JSON.parse(content).toolPermissions as Array<{
        toolName: string;
        permission: { type: string };
      }>;
      expect(entries.find(({ toolName }) => toolName === "view")?.permission.type).toBe("ask-user");
    });

    it("AugmentCode gives a tool whose allows were all withheld the blanket '*' fallback", async () => {
      const content = await generate({ generator: AugmentcodePermissions, permission: envDeny });
      const entries = JSON.parse(content).toolPermissions as Array<{
        toolName: string;
        permission: { type: string };
      }>;
      expect(entries.find(({ toolName }) => toolName === "view")?.permission.type).toBe("deny");
      expect(entries.some(({ permission }) => permission.type === "allow")).toBe(false);
    });
  });

  it("Takt derives readonly from an ask in a file category", async () => {
    const content = await generate({
      generator: TaktPermissions,
      permission: { edit: { "*": "allow", ".env": "ask" }, bash: { "*": "allow" } },
    });
    expect(content).toContain("default_permission_mode: readonly");
  });

  it("Junie writes every ask ahead of every allow in a group", async () => {
    const content = await generate({
      generator: JuniePermissions,
      permission: { edit: { "*": "allow" }, write: { ".env": "deny" } },
      global: true,
    });
    const rules = JSON.parse(content).rules.fileEditing.rules as Array<{ action: string }>;
    expect(rules.map(({ action }) => action)).toEqual(["ask", "allow"]);
  });

  it("an MCP tool's skipped restriction leaves other MCP tools' allows alone", async () => {
    const cursor = await generate({
      generator: CursorPermissions,
      permission: { mcp__a__x: { "*": "ask" }, mcp__b__y: { "*": "allow" } },
    });
    expect(cursor).toContain("b:y");
    const antigravity = await generate({
      generator: AntigravityCliPermissions,
      permission: { mcp__a__x: { "owner:foo": "ask" }, mcp__b__y: { "*": "allow" } },
      global: true,
    });
    expect(antigravity).toContain("b/y");
  });

  it("Antigravity withholds the catch-all allow a skipped glob deny covers", async () => {
    const content = await generate({
      generator: AntigravityCliPermissions,
      permission: { read: { "*": "allow", "**/.env": "deny" } },
      global: true,
    });
    expect(content).not.toContain("read_file");
  });
});
