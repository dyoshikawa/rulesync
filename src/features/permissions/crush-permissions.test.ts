import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushPermissions } from "./crush-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissions(
  permission: Record<string, Record<string, string>>,
): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });
}

describe("CrushPermissions", () => {
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

  const projectConfigPath = () => join(testDir, "crush.json");

  describe("getSettablePaths", () => {
    it("should point to crush.json in project mode", () => {
      expect(CrushPermissions.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
    });

    it("should point to .config/crush/crush.json in global mode", () => {
      expect(CrushPermissions.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "crush.json",
      });
    });
  });

  describe("flags", () => {
    it("should never be deletable and skip creation for an empty payload", () => {
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "",
      });
      expect(permissions.isDeletable()).toBe(false);
      expect(permissions.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should write catch-all allows to allowed_tools and denies to disabled_tools", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow" },
          read: { "**": "allow" },
          webfetch: { "*": "deny" },
          sourcegraph: { "*": "deny" },
          edit: { "*": "ask" },
          mcp__github__create_issue: { "*": "allow" },
        }),
      });

      expect(permissions.getJson()).toEqual({
        permissions: { allowed_tools: ["bash", "view", "mcp_github_create_issue"] },
        options: { disabled_tools: ["fetch", "sourcegraph"] },
      });
    });

    it("should skip pattern-specific rules and keep a restricted tool on prompt", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "allow", "git push *": "deny" },
          read: { "*": "allow", "*.env": "ask" },
          write: { "*": "allow", "src/**": "allow" },
        }),
        logger,
      });

      // `write` only carries a pattern-specific allow, so its catch-all allow
      // is still written; `bash` and `read` carry restrictions and stay off.
      expect(permissions.getJson()).toEqual({
        permissions: { allowed_tools: ["write"] },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"git push *"'));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Crush keeps prompting for "bash"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Crush keeps prompting for "view"'),
      );
    });

    it("should honor an all-tools restriction on bash and skip the * category itself", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "*": "allow", "rm -rf *": "deny" },
          bash: { "*": "allow" },
          read: { "*": "allow" },
        }),
        logger,
      });

      // The `*` deny is mirrored onto bash, which then carries a restriction,
      // and it withholds the `read` catch-all allow too: the stricter rule wins
      // whatever its width, so Crush keeps prompting for `view`.
      expect(permissions.getJson()).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Crush has no allow-all or disable-all tool list"),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("read: *"));
    });

    it("should keep a tool a '*' path deny covers out of allowed_tools and keep safe_commands", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { ".env": "deny" },
          read: { "*": "allow" },
          edit: { "*": "allow" },
          bash: { "go build": "allow" },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({
        permissions: { safe_commands: ["go build"] },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("read: *, edit: *"));
    });

    it("should map exact allows to safe_commands and whole-command denies to blocked_commands", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: {
            "go build": "allow",
            "cargo check --workspace": "allow",
            "git *": "allow",
            "nohup make": "allow",
            "/usr/bin/make": "allow",
            'echo "hi"': "allow",
            "kubectl *": "deny",
            terraform: "deny",
            "npm publish *": "deny",
            "helm *": "ask",
          },
          read: { "*": "allow" },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({
        permissions: {
          allowed_tools: ["view"],
          safe_commands: ["go build", "cargo check --workspace"],
          blocked_commands: ["kubectl", "terraform"],
        },
      });
      for (const skipped of ["git *", "nohup make", "/usr/bin/make", "npm publish *", "helm *"]) {
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`"${skipped}"`));
      }
      // A blocked command is not a full deny, which is reported.
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("which is not a full deny"));
      // An ask is never written to blocked_commands, which would refuse the
      // command's read-only forms outright.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Crush has no per-command prompt list"),
      );
    });

    it("should withhold a safe command line that any deny or ask overlaps", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "git push": "deny" },
          bash: {
            // Crush also approves `go build --`, which the deny names.
            "go build": "allow",
            "go build *": "deny",
            // Crush approves `nice npm test` as `npm test`.
            "npm test": "allow",
            "nice *": "ask",
            // An all-tools deny on the same line wins over the allow.
            "git push": "allow",
          },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({});
      for (const withheld of ["go build", "npm test"]) {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `pattern "${withheld}") is not added to permissions.safe_commands`,
          ),
        );
      }
    });

    it("should compare wrapper spellings with a path or another case", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: {
            // Crush approves `/usr/bin/env go build` and `NICE make` as well.
            "go build": "allow",
            "/usr/bin/env *": "deny",
            make: "allow",
            "NICE *": "ask",
          },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/pattern "go build"\).*"\/usr\/bin\/env \*"/),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/pattern "make"\).*"NICE \*"/),
      );
      for (const withheld of ["go build", "make"]) {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `pattern "${withheld}") is not added to permissions.safe_commands`,
          ),
        );
      }
    });

    it.each([
      ["a relative path", { "go build": "allow", "./nice *": "deny" }],
      ["a Windows path with a suffix", { "go build": "allow", "bin\\Env.EXE *": "ask" }],
      ["a wildcard directory", { "go build": "allow", "b*nohup *": "ask" }],
      ["a wildcard across a directory", { "go build": "allow", "/u*v *": "deny" }],
      ["a wildcard inside a wrapper name", { "go build": "allow", "u*v *": "deny" }],
    ] as const)("should compare wrapper spellings with %s", async (_label, bash) => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { ...bash } }),
      });

      expect(permissions.getJson()).toEqual({});
    });

    it("should not let an unrelated restriction withhold a safe line", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "cargo check": "allow", "rm *": "deny", "rm*": "deny", "./scripts/x *": "ask" },
        }),
      });

      expect(permissions.getJson()).toEqual({
        permissions: { safe_commands: ["cargo check"], blocked_commands: ["rm"] },
      });
    });

    it("should not block a command wrapper or keyword, which Crush resolves first", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "nice *": "deny", time: "deny", "kubectl *": "deny" },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({ permissions: { blocked_commands: ["kubectl"] } });
      for (const name of ["nice", "time"]) {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`command wrapper or keyword "${name}"`),
        );
      }
    });

    it("should warn when a kept blocked command refuses a safe line", async () => {
      const logger = createMockLogger();
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ permissions: { blocked_commands: ["/usr/bin/NPM"] } }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "npm test": "allow" } }),
        logger,
      });

      expect(permissions.getJson()).toEqual({
        permissions: { safe_commands: ["npm test"], blocked_commands: ["/usr/bin/NPM"] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('blocked_commands entry "/usr/bin/NPM" is kept'),
      );
    });

    it("should not block the command of an allowed safe line", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { npm: "deny", "npm test": "allow" },
        }),
        logger,
      });

      // Blocking `npm` would make Crush refuse the allowed `npm test`.
      expect(permissions.getJson()).toEqual({ permissions: { safe_commands: ["npm test"] } });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('on "npm" is not added to permissions.blocked_commands'),
      );
    });

    it("should keep hand-written blocked commands whatever the canonical rules say", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ permissions: { blocked_commands: ["kubectl", "helm"] } }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "kubectl get *": "deny", "helm *": "allow", "docker *": "deny" },
        }),
      });

      expect(permissions.getJson()).toEqual({
        permissions: { blocked_commands: ["kubectl", "helm", "docker"] },
      });
    });

    it("should withhold every safe command line under a catch-all ask", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "ask", "go build": "allow" },
        }),
      });

      expect(permissions.getJson()).toEqual({});
    });

    it("should keep the user's command entries and drop safe ones a restriction covers", async () => {
      const logger = createMockLogger();
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({
          permissions: {
            allowed_commands: ["curl"],
            safe_commands: ["make lint", "rm -rf build", "ls *.txt", "go build"],
            blocked_commands: ["terraform", "/usr/bin/Kubectl"],
          },
        }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "rm *": "deny", "kubectl *": "allow", "go build": "ask" },
        }),
        logger,
      });

      // `rm -rf build` would auto-approve a denied command, `ls *.txt` cannot be
      // analyzed while the config restricts anything, and `go build` is now an
      // ask. Blocked entries are all kept, and the `rm *` deny adds `rm`.
      expect(permissions.getJson()).toEqual({
        permissions: {
          allowed_commands: ["curl"],
          safe_commands: ["make lint"],
          blocked_commands: ["terraform", "/usr/bin/Kubectl", "rm"],
        },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"rm -rf build" was removed'),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"ls *.txt" was removed'));
    });

    it("should not disable an MCP tool through options.disabled_tools", async () => {
      const logger = createMockLogger();
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          mcp__github__delete_repo: { "*": "deny" },
        }),
        logger,
      });

      expect(permissions.getJson()).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("only covers built-in tools"),
      );
    });

    it("should preserve unmanaged entries and sibling keys, and retract stale managed ones", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({
          providers: { anthropic: {} },
          permissions: { allowed_tools: ["ls", "bash", "edit:write", "view:read"] },
          options: { debug: true, disabled_tools: ["sourcegraph", "view"] },
        }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "*": "ask" },
          read: { "*": "allow" },
          edit: { "*": "deny" },
        }),
      });

      // `tool:action` entries are narrower than anything rulesync derives, so
      // they survive even for a managed tool; the bare `bash` is retracted.
      expect(permissions.getJson()).toEqual({
        providers: { anthropic: {} },
        permissions: { allowed_tools: ["ls", "edit:write", "view:read", "view"] },
        options: { debug: true, disabled_tools: ["sourcegraph", "edit"] },
      });
    });

    it("should retract an emptied list and leave absent groups absent", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ permissions: { allowed_tools: ["bash"] } }),
      );

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "ask" } }),
      });

      expect(permissions.getJson()).toEqual({ permissions: {} });
    });

    it("should produce an empty payload when nothing is expressible", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "git *": "allow" } }),
      });

      expect(permissions.getJson()).toEqual({});
    });

    it("should write into an existing .crush.json instead of crush.json", async () => {
      await writeFileContent(join(testDir, ".crush.json"), JSON.stringify({ options: {} }));

      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
      });

      expect(permissions.getRelativeFilePath()).toBe(".crush.json");
      expect(permissions.getJson()).toEqual({
        options: {},
        permissions: { allowed_tools: ["bash"] },
      });
    });

    it("should target ~/.config/crush/crush.json in global mode", async () => {
      const permissions = await CrushPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
        global: true,
      });

      expect(permissions.getRelativeDirPath()).toBe(join(".config", "crush"));
      expect(permissions.getRelativeFilePath()).toBe("crush.json");
    });

    it("should fail closed on an unparseable existing config", async () => {
      await writeFileContent(projectConfigPath(), "{ not json");

      await expect(
        CrushPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "*": "allow" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing config and default to empty when missing", async () => {
      const missing = await CrushPermissions.fromFile({ outputRoot: testDir });
      expect(missing.getJson()).toEqual({});

      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ permissions: { allowed_tools: ["bash"] } }),
      );
      const present = await CrushPermissions.fromFile({ outputRoot: testDir });
      expect(present.getJson()).toEqual({ permissions: { allowed_tools: ["bash"] } });
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should map both lists back to catch-all rules", () => {
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: `{
          "permissions": { "allowed_tools": ["bash", "view", "edit:write", "mcp_github_create_issue", "sourcegraph", "__proto__", "toString"] },
          "options": { "disabled_tools": ["fetch", "sourcegraph", "valueOf"] }
        }`,
      });

      const json = permissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({
        bash: { "*": "allow" },
        read: { "*": "allow" },
        mcp_github_create_issue: { "*": "allow" },
        webfetch: { "*": "deny" },
        // A disabled tool never runs, so the deny wins over the stale allow.
        sourcegraph: { "*": "deny" },
        // An inherited-property name gets its own bucket instead of writing
        // into Object.prototype's function.
        toString: { "*": "allow" },
        valueOf: { "*": "deny" },
      });
      expect(Object.hasOwn(Object.prototype.toString, "*")).toBe(false);
      expect(Object.hasOwn(Object.prototype.valueOf, "*")).toBe(false);
    });

    it("should map the command lists back to bash pattern rules", () => {
      const logger = createMockLogger();
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: `{
          "permissions": {
            "allowed_tools": ["bash"],
            "safe_commands": ["go  build", "/usr/bin/Cargo check", "kubectl get", "ls *.txt", "nohup make", "__proto__"],
            "blocked_commands": ["/usr/bin/KUBECTL", "terraform.exe", "rm -rf", "constructor"],
            "allowed_commands": ["curl"]
          }
        }`,
      });

      const json = permissions.toRulesyncPermissions({ logger }).getJson();
      expect(json.permission).toEqual({
        bash: {
          kubectl: "deny",
          "kubectl *": "deny",
          terraform: "deny",
          "terraform *": "deny",
          "go build": "allow",
          "cargo check": "allow",
          "kubectl get": "allow",
          "*": "allow",
        },
      });
      for (const skipped of ["ls *.txt", "nohup make", "__proto__", "rm -rf", "constructor"]) {
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`"${skipped}"`));
      }
      expect(Object.hasOwn(Object.prototype, "kubectl")).toBe(false);
    });

    it("should yield no rules when the config has neither list", () => {
      const permissions = new CrushPermissions({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(permissions.toRulesyncPermissions().getJson().permission).toEqual({});
    });
  });
});
