import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { AntigravityCliPermissions } from "./antigravity-cli-permissions.js";
import { AntigravityIdePermissions } from "./antigravity-ide-permissions.js";
import { CodexcliPermissions } from "./codexcli-permissions.js";
import { CopilotcliPermissions } from "./copilotcli-permissions.js";
import { CursorPermissions } from "./cursor-permissions.js";
import { DevinPermissions } from "./devin-permissions.js";
import { JuniePermissions } from "./junie-permissions.js";
import { KimiCodePermissions } from "./kimi-code-permissions.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { PoolPermissions } from "./pool-permissions.js";
import { QwencodePermissions } from "./qwencode-permissions.js";
import { ReasonixPermissions } from "./reasonix-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { honorAllToolsRestrictions, withholdAllowsShadowedByAsks } from "./shadowed-allows.js";
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

  it("drops pattern-specific '*' entries but keeps the catch-all when asked to", () => {
    const result = honorAllToolsRestrictions({
      permission: { "*": { "*": "ask", ".env": "deny" } },
      toolLabel: "Tool",
      dropAllToolsPatterns: true,
    });

    expect(result["*"]).toEqual({ "*": "ask" });
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
      "%s writes no catch-all allow and no literal *(...) entry",
      async (_, generator, global) => {
        const content = await generate({ generator, permission: envDeny, global });
        expect(content).not.toContain("*(.env)");
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
        expect(content).not.toContain("*(rm *)");
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

  it("Antigravity withholds the catch-all allow a skipped glob deny covers", async () => {
    const content = await generate({
      generator: AntigravityCliPermissions,
      permission: { read: { "*": "allow", "**/.env": "deny" } },
      global: true,
    });
    expect(content).not.toContain("read_file");
  });
});
