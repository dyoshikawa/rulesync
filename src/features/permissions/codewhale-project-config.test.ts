import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { writeFileContent } from "../../utils/file.js";
import {
  createCodewhaleProjectConfigFile,
  deniesEveryShellCommand,
  readCodewhaleProjectShellDisabled,
} from "./codewhale-project-config.js";

describe("codewhale project config overlay (.codewhale/config.toml)", () => {
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

  const configPath = (): string => join(testDir, ".codewhale", "config.toml");

  const create = (permission: PermissionsConfig["permission"], logger = createMockLogger()) =>
    createCodewhaleProjectConfigFile({ outputRoot: testDir, config: { permission }, logger });

  describe("deniesEveryShellCommand", () => {
    it.each([
      [{ bash: { "*": "deny" } }, true],
      [{ bash: { " ** ": "deny" } }, true],
      [{ "*": { "*": "deny" } }, true],
      [{ bash: { "*": "deny", "git status": "allow" } }, true],
      [{ bash: { "*": "ask" } }, false],
      [{ bash: { "rm *": "deny" } }, false],
      [{ read: { "*": "deny" } }, false],
      [{}, false],
    ] as const)("%j -> %s", (permission, expected) => {
      expect(deniesEveryShellCommand(permission)).toBe(expected);
    });
  });

  describe("createCodewhaleProjectConfigFile", () => {
    it("writes allow_shell = false when every shell command is denied", async () => {
      const file = await create({ bash: { "*": "deny" } });

      expect(file?.getRelativeDirPath()).toBe(".codewhale");
      expect(file?.getRelativeFilePath()).toBe("config.toml");
      expect(smolToml.parse(file?.getFileContent() ?? "")).toEqual({ allow_shell: false });
    });

    it("keeps the other overlay keys and replaces allow_shell = true", async () => {
      await writeFileContent(
        configPath(),
        ['model = "deepseek-v4-pro"', "allow_shell = true", "", "[tui]", "theme = 1", ""].join(
          "\n",
        ),
      );

      const file = await create({ "*": { "*": "deny" } });

      expect(smolToml.parse(file?.getFileContent() ?? "")).toEqual({
        model: "deepseek-v4-pro",
        allow_shell: false,
        tui: { theme: 1 },
      });
    });

    it("leaves the file alone when shell is already disabled", async () => {
      await writeFileContent(configPath(), "# keep me\nallow_shell = false\n");

      expect(await create({ bash: { "*": "deny" } })).toBeNull();
    });

    it("writes nothing when shell is not denied as a whole", async () => {
      expect(await create({ bash: { "rm *": "deny", "*": "ask" } })).toBeNull();
    });

    it("never removes an existing allow_shell = false, and says so", async () => {
      await writeFileContent(configPath(), "allow_shell = false\n");
      const logger = createMockLogger();

      expect(await create({ bash: { "git *": "allow" } }, logger)).toBeNull();
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining('keeping "allow_shell = false"'),
      );
    });

    it("refuses an existing file that is not valid TOML", async () => {
      await writeFileContent(configPath(), "allow_shell = \n");

      await expect(create({ bash: { "*": "deny" } })).rejects.toThrow(/Failed to parse/);
    });
  });

  describe("readCodewhaleProjectShellDisabled", () => {
    it("is true only for allow_shell = false", async () => {
      expect(await readCodewhaleProjectShellDisabled({ outputRoot: testDir })).toBe(false);

      await writeFileContent(configPath(), "allow_shell = true\n");
      expect(await readCodewhaleProjectShellDisabled({ outputRoot: testDir })).toBe(false);

      await writeFileContent(configPath(), 'model = "x"\nallow_shell = false\n');
      expect(await readCodewhaleProjectShellDisabled({ outputRoot: testDir })).toBe(true);
    });

    it("warns and reads false for a file that is not valid TOML", async () => {
      await writeFileContent(configPath(), "allow_shell = \n");
      const logger = createMockLogger();

      expect(await readCodewhaleProjectShellDisabled({ outputRoot: testDir, logger })).toBe(false);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining("not reading"));
    });
  });
});
