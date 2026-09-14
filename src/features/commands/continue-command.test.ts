import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { ContinueCommand } from "./continue-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const PROMPTS_DIR = join(".continue", "prompts");

const buildRulesyncCommand = ({
  frontmatter,
  body = "Review the change: $ARGUMENTS",
  relativeFilePath = "review.md",
}: {
  frontmatter: Record<string, unknown>;
  body?: string;
  relativeFilePath?: string;
}): RulesyncCommand =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets: ["*"], description: "Review a change", ...frontmatter },
    body,
    fileContent: "",
    validate: true,
  });

describe("ContinueCommand", () => {
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

  describe("getSettablePaths", () => {
    it("points to .continue/prompts in both scopes", () => {
      expect(ContinueCommand.getSettablePaths()).toEqual({ relativeDirPath: PROMPTS_DIR });
      expect(ContinueCommand.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: PROMPTS_DIR,
      });
    });
  });

  describe("constructor", () => {
    it("serializes the frontmatter and body", () => {
      const command = new ContinueCommand({
        relativeDirPath: PROMPTS_DIR,
        relativeFilePath: "review.md",
        frontmatter: { name: "review", description: "Review", invokable: true },
        body: "Do a review",
      });

      const { frontmatter, body } = parseFrontmatter(command.getFileContent());
      expect(frontmatter).toEqual({ name: "review", description: "Review", invokable: true });
      expect(body.trim()).toBe("Do a review");
      expect(command.getBody()).toBe("Do a review");
    });

    it("rejects an invalid frontmatter when validation is on", () => {
      expect(
        () =>
          new ContinueCommand({
            relativeDirPath: PROMPTS_DIR,
            relativeFilePath: "review.md",
            frontmatter: { invokable: "yes" as unknown as boolean },
            body: "x",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("emits name from the file stem, the description and invokable: true", () => {
      const command = ContinueCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildRulesyncCommand({ frontmatter: {} }),
      });

      expect(command.getRelativeDirPath()).toBe(PROMPTS_DIR);
      expect(command.getRelativeFilePath()).toBe("review.md");
      expect(command.getFrontmatter()).toEqual({
        name: "review",
        description: "Review a change",
        invokable: true,
      });
      expect(command.getBody()).toBe("Review the change: $ARGUMENTS");
    });

    it("lets the continue block override name and add extra keys, but never invokable", () => {
      const command = ContinueCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildRulesyncCommand({
          frontmatter: {
            continue: { name: "code-review", description: "Continue-only", invokable: false },
          },
        }),
      });

      expect(command.getFrontmatter()).toEqual({
        name: "code-review",
        description: "Continue-only",
        invokable: true,
      });
    });

    it("derives the name from the basename of a nested path", () => {
      const command = ContinueCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildRulesyncCommand({
          frontmatter: {},
          relativeFilePath: join("git", "commit.md"),
        }),
      });

      expect(command.getFrontmatter().name).toBe("commit");
    });

    it("uses the same relative directory in global mode", () => {
      const command = ContinueCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildRulesyncCommand({ frontmatter: {} }),
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(PROMPTS_DIR);
    });
  });

  describe("toRulesyncCommand", () => {
    it("keeps the description and drops the default name and invokable", () => {
      const command = new ContinueCommand({
        relativeDirPath: PROMPTS_DIR,
        relativeFilePath: "review.md",
        frontmatter: { name: "review", description: "Review", invokable: true },
        body: "Do a review",
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand.getFrontmatter()).toEqual({ targets: ["*"], description: "Review" });
      expect(rulesyncCommand.getBody()).toBe("Do a review");
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("review.md");
    });

    it("preserves a customized name and unknown keys under the continue block", () => {
      const command = new ContinueCommand({
        relativeDirPath: PROMPTS_DIR,
        relativeFilePath: "review.md",
        frontmatter: { name: "code-review", description: "Review", invokable: true, version: 2 },
        body: "Do a review",
      });

      expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review",
        continue: { name: "code-review", version: 2 },
      });
    });

    it("round-trips rulesync -> continue -> rulesync", () => {
      const original = buildRulesyncCommand({
        frontmatter: { continue: { name: "custom" } },
      });

      const roundTripped = ContinueCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: original,
      }).toRulesyncCommand();

      expect(roundTripped.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review a change",
        continue: { name: "custom" },
      });
      expect(roundTripped.getBody()).toBe("Review the change: $ARGUMENTS");
    });
  });

  describe("fromFile", () => {
    it("loads a prompt file from .continue/prompts", async () => {
      await ensureDir(join(testDir, PROMPTS_DIR));
      await writeFileContent(
        join(testDir, PROMPTS_DIR, "review.md"),
        [
          "---",
          "name: review",
          "description: Review",
          "invokable: true",
          "---",
          "Do a review",
          "",
        ].join("\n"),
      );

      const command = await ContinueCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "review.md",
      });

      expect(command.getRelativeDirPath()).toBe(PROMPTS_DIR);
      expect(command.getFrontmatter()).toEqual({
        name: "review",
        description: "Review",
        invokable: true,
      });
      expect(command.getBody()).toBe("Do a review");
    });

    it("throws when the file does not exist", async () => {
      await expect(
        ContinueCommand.fromFile({ outputRoot: testDir, relativeFilePath: "missing.md" }),
      ).rejects.toThrow();
    });

    it("throws when the frontmatter is invalid", async () => {
      await ensureDir(join(testDir, PROMPTS_DIR));
      await writeFileContent(
        join(testDir, PROMPTS_DIR, "bad.md"),
        "---\ndescription: 1\n---\nBody\n",
      );

      await expect(
        ContinueCommand.fromFile({ outputRoot: testDir, relativeFilePath: "bad.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("returns true for continue and * targets, false otherwise", () => {
      expect(
        ContinueCommand.isTargetedByRulesyncCommand(
          buildRulesyncCommand({ frontmatter: { targets: ["continue"] } }),
        ),
      ).toBe(true);
      expect(
        ContinueCommand.isTargetedByRulesyncCommand(
          buildRulesyncCommand({ frontmatter: { targets: ["*"] } }),
        ),
      ).toBe(true);
      expect(
        ContinueCommand.isTargetedByRulesyncCommand(
          buildRulesyncCommand({ frontmatter: { targets: ["cursor"] } }),
        ),
      ).toBe(false);
    });
  });

  describe("validate", () => {
    it("succeeds for a valid frontmatter", () => {
      const command = new ContinueCommand({
        relativeDirPath: PROMPTS_DIR,
        relativeFilePath: "review.md",
        frontmatter: { description: "Review" },
        body: "x",
        validate: false,
      });
      expect(command.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("creates an empty instance at the given path", () => {
      const command = ContinueCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: PROMPTS_DIR,
        relativeFilePath: "review.md",
      });
      expect(command.getRelativeFilePath()).toBe("review.md");
      expect(command.getBody()).toBe("");
    });
  });
});
