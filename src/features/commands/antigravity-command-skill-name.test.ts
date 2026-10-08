import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AntigravityIdeSkill } from "../skills/antigravity-ide-skill.js";
import {
  antigravityCommandSkillNameExists,
  resolveAntigravityCommandSkillName,
  rulesyncSkillTakesPrecedence,
} from "./antigravity-command-skill-name.js";
import { RulesyncCommand } from "./rulesync-command.js";

const command = (relativeFilePath: string, frontmatter: Record<string, unknown> = {}) =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets: ["*"], ...frontmatter } as never,
    body: "Body",
    fileContent: "",
  });

describe("resolveAntigravityCommandSkillName", () => {
  it("should prefer the antigravity trigger over the filename", () => {
    expect(
      resolveAntigravityCommandSkillName(
        command("file.md", { antigravity: { trigger: "/custom" } }),
      ),
    ).toBe("custom");
    expect(resolveAntigravityCommandSkillName(command("file.md"))).toBe("file");
  });

  it("should throw when the trigger sanitizes to an empty string", () => {
    expect(() =>
      resolveAntigravityCommandSkillName(command("file.md", { antigravity: { trigger: "/.." } })),
    ).toThrow("Invalid trigger");
  });
});

describe("antigravityCommandSkillNameExists / AntigravitySharedSkill.isDirOwned", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let inputRoot: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    inputRoot = join(testDir, ".rulesync");
  });

  afterEach(async () => {
    await cleanup();
  });

  const writeCommand = async (relativeFilePath: string, frontmatter: string) => {
    await writeFileContent(
      join(inputRoot, "commands", relativeFilePath),
      `---\n${frontmatter}\n---\nBody\n`,
    );
  };

  it("should match commands by resolved trigger and flattened spellings", async () => {
    await writeCommand("triggered.md", 'targets: ["*"]\nantigravity:\n  trigger: /deploy');
    await writeCommand(join("git", "commit.md"), 'targets: ["antigravity-cli"]');

    const exists = (dirName: string, toolTargets: ("antigravity-ide" | "antigravity-cli")[]) =>
      antigravityCommandSkillNameExists({
        inputRoots: [inputRoot],
        dirName,
        toolTargets,
        skillsRelativeDirPath: join(".agents", "skills"),
        global: false,
      });

    expect(await exists("deploy", ["antigravity-ide"])).toBe(true);
    expect(await exists("triggered", ["antigravity-ide"])).toBe(false);
    expect(await exists("commit", ["antigravity-cli"])).toBe(true);
    expect(await exists("git-commit", ["antigravity-cli"])).toBe(true);
    // Targeted at the CLI only.
    expect(await exists("commit", ["antigravity-ide"])).toBe(false);
  });

  const writeSkill = async (dirName: string, targets: string, subdir = "skills") => {
    await writeFileContent(
      join(inputRoot, subdir, dirName, "SKILL.md"),
      `---\nname: ${dirName}\ndescription: d\ntargets: ${targets}\n---\nbody\n`,
    );
  };

  const projectOwned = (dirName: string) =>
    antigravityCommandSkillNameExists({
      inputRoots: [inputRoot],
      dirName,
      toolTargets: ["antigravity-ide"],
      skillsRelativeDirPath: join(".agents", "skills"),
      global: false,
    });

  it("should leave the directory to a rulesync skill written to the same tree", async () => {
    await writeCommand("deploy.md", 'targets: ["*"]');
    await writeCommand("review.md", 'targets: ["*"]');
    await writeCommand("curated.md", 'targets: ["*"]');
    await writeSkill("deploy", '["*"]');
    // Codex CLI also writes project skills to `.agents/skills/`.
    await writeSkill("review", '["codexcli"]');
    await writeSkill("curated", '["antigravity-cli"]', join("skills", ".curated"));

    expect(await projectOwned("deploy")).toBe(false);
    expect(await projectOwned("review")).toBe(false);
    expect(await projectOwned("curated")).toBe(false);
  });

  it("should keep the directory when the same-named skill is written elsewhere", async () => {
    await writeCommand("deploy.md", 'targets: ["*"]');
    await writeSkill("deploy", '["claudecode"]');

    expect(await projectOwned("deploy")).toBe(true);
    expect(
      await rulesyncSkillTakesPrecedence({
        inputRoots: [inputRoot],
        dirName: "deploy",
        skillsRelativeDirPath: join(".agents", "skills"),
        global: false,
      }),
    ).toBe(false);
  });

  it("should let the last input root decide which command owns a name", async () => {
    const localRoot = join(testDir, ".rulesync.local");
    await writeCommand("deploy.md", 'targets: ["antigravity-ide"]');
    await writeFileContent(
      join(localRoot, "commands", "deploy.md"),
      '---\ntargets: ["claudecode"]\n---\nBody\n',
    );

    expect(
      await antigravityCommandSkillNameExists({
        inputRoots: [inputRoot, localRoot],
        dirName: "deploy",
        toolTargets: ["antigravity-ide"],
        skillsRelativeDirPath: join(".agents", "skills"),
        global: false,
      }),
    ).toBe(false);
  });

  it("should not let the skills feature own a command-emitted project skill directory", async () => {
    await writeCommand("deploy.md", 'targets: ["antigravity-cli"]');

    const isDirOwned = (relativeDirPath: string, dirName: string, global = false) =>
      AntigravityIdeSkill.isDirOwned({
        outputRoot: testDir,
        relativeDirPath,
        dirName,
        inputRoots: [inputRoot],
        global,
      });

    // The project tree is shared with the CLI, whose command emits there.
    expect(await isDirOwned(join(".agents", "skills"), "deploy")).toBe(false);
    expect(await isDirOwned(join(".agents", "skills"), "other")).toBe(true);
    // The IDE's global tree only receives IDE commands.
    expect(await isDirOwned(join(".gemini", "config", "skills"), "deploy", true)).toBe(true);
  });
});
