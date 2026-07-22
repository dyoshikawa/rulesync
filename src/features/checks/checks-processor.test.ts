import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AMP_CHECKS_PROJECT_DIR } from "../../constants/amp-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ConsoleLogger } from "../../utils/logger.js";
import { AmpCheck } from "./amp-check.js";
import { ChecksProcessor } from "./checks-processor.js";
import { RulesyncCheck } from "./rulesync-check.js";

const logger = new ConsoleLogger({ verbose: false, silent: true });

describe("ChecksProcessor.getToolTargets", () => {
  it("should return project-scoped check targets", () => {
    expect(ChecksProcessor.getToolTargets()).toEqual(["amp", "hermesagent"]);
  });

  it("should return amp for global scope", () => {
    expect(ChecksProcessor.getToolTargets({ global: true })).toEqual(["amp"]);
  });

  it("should return no simulated targets", () => {
    expect(ChecksProcessor.getToolTargetsSimulated()).toEqual([]);
  });

  it("should expose the amp factory", () => {
    expect(ChecksProcessor.getFactory("amp")).toBeDefined();
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
      inputRoot: testDir,
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
      inputRoot: testDir,
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

  it("should return an empty array when the rulesync checks directory is missing", async () => {
    const processor = new ChecksProcessor({
      outputRoot: testDir,
      inputRoot: testDir,
      toolTarget: "amp",
      logger,
    });

    expect(await processor.loadRulesyncFiles()).toEqual([]);
  });
});
