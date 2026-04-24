import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import { ConfigResolver } from "./config-resolver.js";
import { resetDeprecationWarningForTests } from "./deprecation-warnings.js";

const { getHomeDirectoryMock } = vi.hoisted(() => {
  return {
    getHomeDirectoryMock: vi.fn(),
  };
});

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    getHomeDirectory: getHomeDirectoryMock,
  };
});

describe("config-resolver", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let homeDir: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    homeDir = testDir;
    // Convert relative testDir to absolute path for mocking process.cwd()
    const absoluteTestDir = resolve(testDir);
    vi.spyOn(process, "cwd").mockReturnValue(absoluteTestDir);
    getHomeDirectoryMock.mockReturnValue(homeDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    getHomeDirectoryMock.mockClear();
  });

  describe("global configuration", () => {
    it("should load global: true from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(true);
    });

    it("should load global: false from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should default global to false when not specified", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should allow CLI flag to override config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        global: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        global: true,
      });

      expect(config.getGlobal()).toBe(true);
    });
  });

  describe("silent configuration", () => {
    it("should load silent: true from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        silent: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSilent()).toBe(true);
    });

    it("should load silent: false from config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        silent: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSilent()).toBe(false);
    });

    it("should default silent to false when not specified", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getSilent()).toBe(false);
    });

    it("should allow CLI flag to override config file for silent", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        silent: false,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        silent: true,
      });

      expect(config.getSilent()).toBe(true);
    });
  });

  describe("base directory resolution", () => {
    it("should load configured baseDirs from file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./src", "./packages"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      // baseDirs are now resolved to absolute paths
      expect(config.getBaseDirs()).toContain(resolve("./src"));
      expect(config.getBaseDirs()).toContain(resolve("./packages"));
    });

    it("should handle multiple baseDirs", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./app1", "./app2", "./app3"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      // baseDirs are now resolved to absolute paths
      expect(config.getBaseDirs()).toHaveLength(3);
      expect(config.getBaseDirs()).toContain(resolve("./app1"));
      expect(config.getBaseDirs()).toContain(resolve("./app2"));
      expect(config.getBaseDirs()).toContain(resolve("./app3"));
    });
  });

  describe("local configuration (rulesync.local.jsonc)", () => {
    it("should use rulesync.local.jsonc to override rulesync.jsonc", async () => {
      const baseConfigContent = JSON.stringify({
        baseDirs: ["./"],
        targets: ["cursor"],
        verbose: false,
      });
      const localConfigContent = JSON.stringify({
        targets: ["claudecode"],
        verbose: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), baseConfigContent);
      await writeFileContent(join(testDir, "rulesync.local.jsonc"), localConfigContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getTargets()).toEqual(["claudecode"]);
      expect(config.getVerbose()).toBe(true);
    });

    it("should preserve rulesync.jsonc values not overridden by rulesync.local.jsonc", async () => {
      const baseConfigContent = JSON.stringify({
        baseDirs: ["./"],
        targets: ["cursor"],
        features: ["rules", "mcp"],
        verbose: false,
        delete: true,
      });
      const localConfigContent = JSON.stringify({
        verbose: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), baseConfigContent);
      await writeFileContent(join(testDir, "rulesync.local.jsonc"), localConfigContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getTargets()).toEqual(["cursor"]);
      expect(config.getFeatures()).toEqual(["rules", "mcp"]);
      expect(config.getVerbose()).toBe(true);
      expect(config.getDelete()).toBe(true);
    });

    it("should allow CLI options to override rulesync.local.jsonc", async () => {
      const baseConfigContent = JSON.stringify({
        baseDirs: ["./"],
        targets: ["cursor"],
      });
      const localConfigContent = JSON.stringify({
        targets: ["claudecode"],
        verbose: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), baseConfigContent);
      await writeFileContent(join(testDir, "rulesync.local.jsonc"), localConfigContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
        targets: ["copilot"],
        verbose: false,
      });

      expect(config.getTargets()).toEqual(["copilot"]);
      expect(config.getVerbose()).toBe(false);
    });

    it("should work without rulesync.local.jsonc", async () => {
      const baseConfigContent = JSON.stringify({
        baseDirs: ["./"],
        targets: ["cursor"],
        verbose: true,
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), baseConfigContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getTargets()).toEqual(["cursor"]);
      expect(config.getVerbose()).toBe(true);
    });

    it("should work with only rulesync.local.jsonc (no base config)", async () => {
      const localConfigContent = JSON.stringify({
        targets: ["claudecode"],
        verbose: true,
      });
      await writeFileContent(join(testDir, "rulesync.local.jsonc"), localConfigContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getTargets()).toEqual(["claudecode"]);
      expect(config.getVerbose()).toBe(true);
    });

    it("should load rulesync.local.jsonc from the same directory as the base config", async () => {
      const subDir = join(testDir, "subdir");
      await writeFileContent(join(subDir, "rulesync.jsonc"), JSON.stringify({ baseDirs: ["./"] }));
      await writeFileContent(
        join(subDir, "rulesync.local.jsonc"),
        JSON.stringify({ targets: ["cline"] }),
      );

      const config = await ConfigResolver.resolve({
        configPath: join(subDir, "rulesync.jsonc"),
      });

      expect(config.getTargets()).toEqual(["cline"]);
    });
  });

  describe("configPath security", () => {
    it("should accept configPath within current directory", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getBaseDirs()).toHaveLength(1);
    });

    it("should reject configPath with path traversal attempting to escape current directory", async () => {
      await expect(
        ConfigResolver.resolve({
          configPath: "../../etc/passwd",
        }),
      ).rejects.toThrow("Path traversal detected");
    });

    it("should reject absolute paths outside current directory", async () => {
      await expect(
        ConfigResolver.resolve({
          configPath: "/etc/passwd",
        }),
      ).rejects.toThrow("Path traversal detected");
    });

    it("should reject paths attempting to access parent directories", async () => {
      await expect(
        ConfigResolver.resolve({
          configPath: "../../../sensitive-file.txt",
        }),
      ).rejects.toThrow("Path traversal detected");
    });
  });

  describe("object-form targets end-to-end", () => {
    it("should load object-form targets from rulesync.jsonc without reintroducing default features", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        targets: {
          claudecode: { rules: true, ignore: { fileMode: "local" } },
          cursor: ["rules", "mcp"],
        },
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getTargets()).toEqual(["claudecode", "cursor"]);
      expect(config.getFeatures("claudecode")).toEqual(["rules", "ignore"]);
      expect(config.getFeatures("cursor")).toEqual(["rules", "mcp"]);
      expect(config.getFeatureOptions("claudecode", "ignore")).toEqual({ fileMode: "local" });
    });

    it("should reject merged config when base has array-form features and local has object-form targets", async () => {
      const baseConfigContent = JSON.stringify({
        baseDirs: ["./"],
        features: ["rules"],
      });
      const localConfigContent = JSON.stringify({
        targets: { claudecode: ["rules"] },
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), baseConfigContent);
      await writeFileContent(join(testDir, "rulesync.local.jsonc"), localConfigContent);

      await expect(
        ConfigResolver.resolve({ configPath: join(testDir, "rulesync.jsonc") }),
      ).rejects.toThrow(/detected after merging .* with .* the two files combined/);
    });

    it("should reject object-form targets combined with features from a config file", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        targets: { claudecode: ["rules"] },
        features: ["rules"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      await expect(
        ConfigResolver.resolve({ configPath: join(testDir, "rulesync.jsonc") }),
      ).rejects.toThrow(/when 'targets' is in object form, 'features' must be omitted/);
    });
  });

  describe("inputRoot — configPath resolution", () => {
    it("should resolve a relative configPath against inputRoot, not cwd", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ targets: ["claudecode"], verbose: true }),
      );
      // A differently-configured file in cwd that must NOT be picked up.
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify({ targets: ["cursor"], verbose: false }),
      );

      const config = await ConfigResolver.resolve({
        configPath: "rulesync.jsonc",
        inputRoot,
      });

      expect(config.getTargets()).toEqual(["claudecode"]);
      expect(config.getVerbose()).toBe(true);
    });

    it("should resolve the default configPath against inputRoot when no configPath is provided", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ targets: ["claudecode"] }),
      );
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify({ targets: ["cursor"] }),
      );

      const config = await ConfigResolver.resolve({ inputRoot });

      expect(config.getTargets()).toEqual(["claudecode"]);
    });

    it("should load rulesync.local.jsonc from inputRoot alongside the base config", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ targets: ["cursor"], verbose: false }),
      );
      await writeFileContent(
        join(inputRoot, "rulesync.local.jsonc"),
        JSON.stringify({ targets: ["claudecode"], verbose: true }),
      );

      const config = await ConfigResolver.resolve({
        configPath: "rulesync.jsonc",
        inputRoot,
      });

      expect(config.getTargets()).toEqual(["claudecode"]);
      expect(config.getVerbose()).toBe(true);
    });

    it("should reject a relative configPath that escapes inputRoot", async () => {
      const inputRoot = join(testDir, "central-rules");
      // Ensure parent contains a tempting target.
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify({ targets: ["cursor"] }),
      );

      await expect(
        ConfigResolver.resolve({
          configPath: "../rulesync.jsonc",
          inputRoot,
        }),
      ).rejects.toThrow("Path traversal detected");
    });
  });

  describe("inputRoot — global precedence", () => {
    it("should force global to false when inputRoot is set and config file has global: true", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"], global: true }),
      );

      const config = await ConfigResolver.resolve({
        configPath: "rulesync.jsonc",
        inputRoot,
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should warn when dropping config-file global: true because inputRoot overrides it", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"], global: true }),
      );
      const logger = { warn: vi.fn() } as unknown as Logger;

      await ConfigResolver.resolve(
        {
          configPath: "rulesync.jsonc",
          inputRoot,
        },
        { logger },
      );

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring "global: true"'));
    });

    it("should not warn when CLI --global is explicitly passed alongside inputRoot", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"], global: true }),
      );
      const logger = { warn: vi.fn() } as unknown as Logger;

      await ConfigResolver.resolve(
        {
          configPath: "rulesync.jsonc",
          inputRoot,
          global: true,
        },
        { logger },
      );

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should honor config file global: true when inputRoot is omitted", async () => {
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"], global: true }),
      );

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getGlobal()).toBe(true);
    });

    it("should allow CLI --global true to re-enable global even when inputRoot is set", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"], global: true }),
      );

      const config = await ConfigResolver.resolve({
        configPath: "rulesync.jsonc",
        inputRoot,
        global: true,
      });

      expect(config.getGlobal()).toBe(true);
    });

    it("should let explicit CLI --global false win over config file global: true with inputRoot set", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"], global: true }),
      );

      const config = await ConfigResolver.resolve({
        configPath: "rulesync.jsonc",
        inputRoot,
        global: false,
      });

      expect(config.getGlobal()).toBe(false);
    });

    it("should keep global false by default when inputRoot is set and config file does not set global", async () => {
      const inputRoot = join(testDir, "central-rules");
      await writeFileContent(
        join(inputRoot, "rulesync.jsonc"),
        JSON.stringify({ baseDirs: ["./"] }),
      );

      const config = await ConfigResolver.resolve({
        configPath: "rulesync.jsonc",
        inputRoot,
      });

      expect(config.getGlobal()).toBe(false);
    });
  });

  describe("inputRoot — config-file sourcing", () => {
    it("should honor inputRoot set in rulesync.jsonc and propagate it through mergeConfigs", async () => {
      const configuredRoot = join(testDir, "from-config");
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify({ inputRoot: configuredRoot }),
      );

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getInputRoot()).toBe(configuredRoot);
    });

    it("should let rulesync.local.jsonc override inputRoot from rulesync.jsonc", async () => {
      const baseRoot = join(testDir, "from-base");
      const localRoot = join(testDir, "from-local");
      await writeFileContent(
        join(testDir, "rulesync.jsonc"),
        JSON.stringify({ inputRoot: baseRoot }),
      );
      await writeFileContent(
        join(testDir, "rulesync.local.jsonc"),
        JSON.stringify({ inputRoot: localRoot }),
      );

      const config = await ConfigResolver.resolve({
        configPath: join(testDir, "rulesync.jsonc"),
      });

      expect(config.getInputRoot()).toBe(localRoot);
    });
  });

  describe("deprecation warning for object-form features", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      resetDeprecationWarningForTests();
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
      delete process.env.RULESYNC_SILENT_DEPRECATION;
    });

    it("emits the deprecation warning once when features is in object form", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        features: { claudecode: ["rules"] },
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      await ConfigResolver.resolve({ configPath: join(testDir, "rulesync.jsonc") });
      await ConfigResolver.resolve({ configPath: join(testDir, "rulesync.jsonc") });

      const deprecationCalls = warnSpy.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes("DEPRECATED: 'features' object form"),
      );
      expect(deprecationCalls).toHaveLength(1);
    });

    it("does not emit the warning when features is in array form", async () => {
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        targets: ["claudecode"],
        features: ["rules"],
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      await ConfigResolver.resolve({ configPath: join(testDir, "rulesync.jsonc") });

      const deprecationCalls = warnSpy.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes("DEPRECATED: 'features' object form"),
      );
      expect(deprecationCalls).toHaveLength(0);
    });

    it("suppresses the warning when RULESYNC_SILENT_DEPRECATION is set", async () => {
      process.env.RULESYNC_SILENT_DEPRECATION = "1";
      const configContent = JSON.stringify({
        baseDirs: ["./"],
        features: { claudecode: ["rules"] },
      });
      await writeFileContent(join(testDir, "rulesync.jsonc"), configContent);

      await ConfigResolver.resolve({ configPath: join(testDir, "rulesync.jsonc") });

      const deprecationCalls = warnSpy.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes("DEPRECATED: 'features' object form"),
      );
      expect(deprecationCalls).toHaveLength(0);
    });
  });
});
