import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AMP_CHECKS_PROJECT_DIR } from "../../constants/amp-paths.js";
import {
  RULESYNC_CHECKS_RELATIVE_DIR_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ConsoleLogger } from "../../utils/logger.js";
import { AmpCheck } from "./amp-check.js";
import { ChecksProcessor } from "./checks-processor.js";
import { RulesyncCheck } from "./rulesync-check.js";

const logger = new ConsoleLogger({ verbose: false, silent: true });

describe("ChecksProcessor.getToolTargets", () => {
  it("should return project-scoped check targets", () => {
    expect(ChecksProcessor.getToolTargets()).toEqual([
      "amp",
      "augmentcode",
      "cursor",
      "hermesagent",
      "rovodev",
      "takt",
    ]);
  });

  it("should return amp for global scope", () => {
    expect(ChecksProcessor.getToolTargets({ global: true })).toEqual(["amp", "takt"]);
  });

  it("should return no simulated targets", () => {
    expect(ChecksProcessor.getToolTargetsSimulated()).toEqual([]);
  });

  it("should expose the amp factory", () => {
    expect(ChecksProcessor.getFactory("amp")).toBeDefined();
    expect(ChecksProcessor.getFactory("cursor")).toBeDefined();
    expect(ChecksProcessor.getFactory("claudecode")).toBeUndefined();
  });
});

describe("ChecksProcessor constructor", () => {
  it("should throw for an unsupported tool target", () => {
    expect(() => new ChecksProcessor({ toolTarget: "claudecode", logger })).toThrow(
      /Invalid tool target for ChecksProcessor/,
    );
  });
});

describe("ChecksProcessor conversion", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("should load rulesync checks and convert them to Amp checks", async () => {
    const content = `---
targets: ["*"]
description: "Flags issues"
severity: high
---
Look for issues.
`;
    await writeFileContent(
      join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
      content,
    );

    const processor = new ChecksProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
      toolTarget: "amp",
      logger,
    });

    const rulesyncFiles = await processor.loadRulesyncFiles();
    expect(rulesyncFiles).toHaveLength(1);
    expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncCheck);

    const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    expect(toolFiles).toHaveLength(1);
    expect(toolFiles[0]).toBeInstanceOf(AmpCheck);
    expect((toolFiles[0] as AmpCheck).getFrontmatter().name).toBe("security");
  });

  it("should load Amp checks and convert them back to rulesync checks", async () => {
    const content = `---
name: security
description: Flags issues
severity-default: medium
---
Look for issues.
`;
    await writeFileContent(join(testDir, AMP_CHECKS_PROJECT_DIR, "security.md"), content);

    const processor = new ChecksProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
      toolTarget: "amp",
      logger,
    });

    const toolFiles = await processor.loadToolFiles();
    expect(toolFiles).toHaveLength(1);

    const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);
    expect(rulesyncFiles).toHaveLength(1);
    expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncCheck);
    expect((rulesyncFiles[0] as RulesyncCheck).getFrontmatter().severity).toBe("medium");
  });

  it("should load checks when the output root contains glob metacharacters", async () => {
    const literalRoot = join(testDir, "project(glob)");
    await writeFileContent(
      join(literalRoot, AMP_CHECKS_PROJECT_DIR, "literal.md"),
      "---\nname: literal\ndescription: Literal path\n---\n\nContent",
    );

    const processor = new ChecksProcessor({
      outputRoot: literalRoot,
      inputRoots: [join(literalRoot, RULESYNC_RELATIVE_DIR_PATH)],
      toolTarget: "amp",
      logger,
    });

    const toolFiles = await processor.loadToolFiles({ forDeletion: true });

    expect(toolFiles).toHaveLength(1);
    expect(toolFiles[0]?.getRelativeFilePath()).toBe("literal.md");
  });

  // Windows needs elevated rights to create symlinks, so this one is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "should not load symlinked checks for deletion",
    async () => {
      const sharedDir = join(testDir, "shared");
      const checksDir = join(testDir, AMP_CHECKS_PROJECT_DIR);
      await ensureDir(checksDir);
      await writeFileContent(
        join(sharedDir, "shared.md"),
        "---\nname: shared\ndescription: Shared path\n---\n\nContent",
      );
      await symlink(sharedDir, join(checksDir, "team"));

      const processor = new ChecksProcessor({
        outputRoot: testDir,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        toolTarget: "amp",
        logger,
      });

      expect(await processor.loadToolFiles({ forDeletion: true })).toEqual([]);
    },
  );

  it("should return an empty array when the rulesync checks directory is missing", async () => {
    const processor = new ChecksProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
      toolTarget: "amp",
      logger,
    });

    expect(await processor.loadRulesyncFiles()).toEqual([]);
  });

  // Windows needs elevated rights to create symlinks, so this one is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "should record a source load failure for a check file that cannot be read",
    async () => {
      await ensureDir(join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH));
      await symlink(
        join(testDir, "gone.md"),
        join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "broken.md"),
      );

      const processor = new ChecksProcessor({
        outputRoot: testDir,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        toolTarget: "amp",
        logger,
      });

      // Unreadable is not unparseable: skipping it would let the orphan sweep
      // delete a check the run merely could not read.
      expect(await processor.loadRulesyncFiles()).toEqual([]);
      expect(processor.hasRulesyncSourceLoadFailure()).toBe(true);
    },
  );

  it("should not record a source load failure for a check file that will not parse", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "notes.md"),
      "just some notes, no frontmatter",
    );

    const processor = new ChecksProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
      toolTarget: "amp",
      logger,
    });

    expect(await processor.loadRulesyncFiles()).toEqual([]);
    expect(processor.hasRulesyncSourceLoadFailure()).toBe(false);
  });
});
