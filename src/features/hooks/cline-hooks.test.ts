import { stat } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { ToolFile } from "../../types/tool-file.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { CLINE_HOOK_SCRIPT_MARKER } from "./cline-hooks-generator.js";
import { ClineHooks } from "./cline-hooks.js";
import { HooksProcessor } from "./hooks-processor.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (json: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.jsonc",
    fileContent: JSON.stringify(json),
  });

const scriptOf = (files: ToolFile[], relativeFilePath: string): ToolFile | undefined =>
  files.find((file) => file.getRelativeFilePath() === relativeFilePath);

describe("ClineHooks", () => {
  let testDir: string;

  beforeEach(async () => {
    ({ testDir } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  describe("getSettablePaths", () => {
    it("uses the project hooks directory and the global one", () => {
      expect(ClineHooks.getSettablePaths()).toEqual({
        relativeDirPath: join(".clinerules", "hooks"),
        relativeFilePath: "rulesync-hooks.json",
      });
      expect(ClineHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join("Documents", "Cline", "Hooks"),
        relativeFilePath: "rulesync-hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("records the mapped events in the manifest", () => {
      const hooks = ClineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          hooks: {
            sessionStart: [{ type: "command", command: "echo start" }],
            preToolUse: [{ type: "command", command: "echo pre" }],
            // Not part of Cline's VALID_HOOK_TYPES.
            sessionEnd: [{ type: "command", command: "echo end" }],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        generatedBy: "rulesync",
        events: ["PreToolUse", "TaskStart"],
      });
    });

    it("layers the cline override block over the shared hooks", async () => {
      const hooks = ClineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          hooks: { sessionStart: [{ type: "command", command: "echo shared" }] },
          cline: { hooks: { sessionStart: [{ type: "command", command: "echo override" }] } },
        }),
      });

      const files = await hooks.getScriptFiles();
      expect(scriptOf(files, "TaskStart")?.getFileContent()).toContain("echo override");
      expect(scriptOf(files, "TaskStart")?.getFileContent()).not.toContain("echo shared");
    });
  });

  describe("getScriptFiles", () => {
    const hooksFor = (commands: Record<string, { type: string; command: string }[]>) =>
      ClineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ hooks: commands }),
      });

    it("emits a POSIX script and a PowerShell twin per event", async () => {
      const files = await hooksFor({
        sessionStart: [{ type: "command", command: "echo start" }],
      }).getScriptFiles();

      expect(files.map((file) => file.getRelativeFilePath()).toSorted()).toEqual([
        "TaskStart",
        "TaskStart.ps1",
      ]);
      const posix = scriptOf(files, "TaskStart");
      expect(posix?.getFileContent()).toContain("#!/bin/bash");
      expect(posix?.getFileContent()).toContain("echo start");
      expect(posix?.getFileContent()).toContain(CLINE_HOOK_SCRIPT_MARKER);
      expect(posix?.getRelativeDirPath()).toBe(join(".clinerules", "hooks"));
      // Cline spawns the POSIX file itself; the .ps1 twin runs via powershell -File.
      expect(posix?.getFileMode()).toBe(0o755);
      expect(scriptOf(files, "TaskStart.ps1")?.getFileMode()).toBeUndefined();
    });

    it("runs several commands for one event in source order", async () => {
      const files = await hooksFor({
        preToolUse: [
          { type: "command", command: "echo first" },
          { type: "command", command: "echo second" },
        ],
      }).getScriptFiles();

      const content = scriptOf(files, "PreToolUse")?.getFileContent() ?? "";
      expect(content.indexOf("echo first")).toBeGreaterThan(-1);
      expect(content.indexOf("echo first")).toBeLessThan(content.indexOf("echo second"));
    });

    it("never overwrites a hand-authored hook script", async () => {
      const handWritten = "#!/bin/bash\necho mine\n";
      await writeFileContent(join(testDir, ".clinerules", "hooks", "TaskStart"), handWritten);

      const hooks = hooksFor({ sessionStart: [{ type: "command", command: "echo start" }] });
      const files = await hooks.getScriptFiles();

      expect(scriptOf(files, "TaskStart")).toBeUndefined();
      // The .ps1 twin does not exist yet, so it is still generated.
      expect(scriptOf(files, "TaskStart.ps1")).toBeDefined();
      expect(await readFileContent(join(testDir, ".clinerules", "hooks", "TaskStart"))).toBe(
        handWritten,
      );
    });

    it("neutralizes a script whose event is no longer configured", async () => {
      await writeFileContent(
        join(testDir, ".clinerules", "hooks", "rulesync-hooks.json"),
        JSON.stringify({ generatedBy: "rulesync", events: ["TaskStart", "PreToolUse"] }),
      );
      await writeFileContent(
        join(testDir, ".clinerules", "hooks", "PreToolUse"),
        `#!/bin/bash\n# ${CLINE_HOOK_SCRIPT_MARKER}\necho stale\n`,
      );

      const files = await hooksFor({
        sessionStart: [{ type: "command", command: "echo start" }],
      }).getScriptFiles();

      const stale = scriptOf(files, "PreToolUse")?.getFileContent() ?? "";
      expect(stale).toContain(CLINE_HOOK_SCRIPT_MARKER);
      expect(stale).not.toContain("echo stale");
      expect(stale).toContain('"cancel": %s');
    });

    it("ignores a manifest event that is not one of Cline's hook types", async () => {
      await writeFileContent(
        join(testDir, ".clinerules", "hooks", "rulesync-hooks.json"),
        JSON.stringify({
          generatedBy: "rulesync",
          events: ["../../.git/hooks/pre-commit", "NotAnEvent", "PreToolUse"],
        }),
      );

      const files = await hooksFor({
        sessionStart: [{ type: "command", command: "echo start" }],
      }).getScriptFiles();

      expect(files.map((file) => file.getRelativeFilePath()).toSorted()).toEqual([
        "PreToolUse",
        "PreToolUse.ps1",
        "TaskStart",
        "TaskStart.ps1",
      ]);
    });

    it("warns instead of silently skipping a hand-authored collision", async () => {
      await writeFileContent(
        join(testDir, ".clinerules", "hooks", "TaskStart"),
        "#!/bin/bash\necho mine\n",
      );
      const logger = createMockLogger();

      await hooksFor({ sessionStart: [{ type: "command", command: "echo start" }] }).getScriptFiles(
        { logger },
      );

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("TaskStart"));
    });
  });

  describe("getAuxiliaryFiles for deletion", () => {
    it("collects the rulesync-marked scripts and leaves hand-authored ones", async () => {
      const hooksDir = join(testDir, ".clinerules", "hooks");
      await writeFileContent(
        join(hooksDir, "TaskStart"),
        `#!/bin/bash\n# ${CLINE_HOOK_SCRIPT_MARKER}\necho generated\n`,
      );
      await writeFileContent(join(hooksDir, "PreToolUse"), "#!/bin/bash\necho mine\n");

      const files = await ClineHooks.getAuxiliaryFiles({
        outputRoot: testDir,
        forDeletion: true,
      });

      expect(files.map((file) => file.getRelativeFilePath())).toEqual(["TaskStart"]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("refuses to import generated scripts", () => {
      const hooks = ClineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ hooks: {} }),
      });
      expect(() => hooks.toRulesyncHooks()).toThrow(/cannot be imported/);
    });
  });

  describe("file mode", () => {
    it.runIf(process.platform !== "win32")(
      "writes the POSIX script with the executable bit",
      async () => {
        const processor = new HooksProcessor({
          outputRoot: testDir,
          toolTarget: "cline",
          logger: createMockLogger(),
        });
        const toolFiles = await processor.convertRulesyncFilesToToolFiles([
          buildRulesyncHooks({
            hooks: { sessionStart: [{ type: "command", command: "echo start" }] },
          }),
        ]);
        await processor.writeAiFiles(toolFiles);

        const mode = (await stat(join(testDir, ".clinerules", "hooks", "TaskStart"))).mode;
        expect(mode & 0o111).not.toBe(0);
      },
    );
  });
});
