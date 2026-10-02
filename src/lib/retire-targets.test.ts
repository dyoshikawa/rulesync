import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Config, type ConfigParams } from "../config/config.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { fileExists, writeFileContent } from "../utils/file.js";
import { generate } from "./generate.js";

const RULE = `---
root: true
targets: ["*"]
---
# Overview
`;

const SKILL = `---
name: demo
description: Demo skill
targets: ["*"]
---
Body
`;

describe("generate with retireTargets", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    await writeFileContent(join(testDir, ".rulesync", "rules", "overview.md"), RULE);
  });

  afterEach(async () => {
    await cleanup();
  });

  const createConfig = (params: Partial<ConfigParams>): Config =>
    new Config({
      outputRoots: [testDir],
      inputRoots: [join(testDir, ".rulesync")],
      targets: ["claudecode"],
      features: ["rules"],
      verbose: false,
      delete: false,
      ...params,
    });

  const writeStaleCursorRule = async (root = testDir): Promise<string> => {
    const path = join(root, ".cursor", "rules", "old.mdc");
    await writeFileContent(path, "---\nalwaysApply: true\n---\nStale\n");
    return path;
  };

  it("deletes the managed outputs of a retired target and keeps unrelated files", async () => {
    const stale = await writeStaleCursorRule();
    const notes = join(testDir, ".cursor", "rules", "notes.txt");
    const readme = join(testDir, ".cursor", "README.md");
    await writeFileContent(notes, "mine");
    await writeFileContent(readme, "mine");

    const result = await generate({
      config: createConfig({ retireTargets: ["cursor"] }),
      logger: createMockLogger(),
    });

    expect(result.hasDiff).toBe(true);
    expect(await fileExists(stale)).toBe(false);
    expect(await fileExists(notes)).toBe(true);
    expect(await fileExists(readme)).toBe(true);
    expect(await fileExists(join(testDir, "CLAUDE.md"))).toBe(true);
  });

  it("is idempotent, so an interrupted retirement can simply be rerun", async () => {
    await writeStaleCursorRule();
    const config = createConfig({ retireTargets: ["cursor"] });

    await generate({ config, logger: createMockLogger() });
    const second = await generate({ config, logger: createMockLogger() });

    expect(second.hasDiff).toBe(false);
  });

  it("keeps a file that a configured target still writes", async () => {
    const agentsMd = join(testDir, "AGENTS.md");
    const generateAgentsMd = () =>
      generate({ config: createConfig({ targets: ["agentsmd"] }), logger: createMockLogger() });

    await generateAgentsMd();
    await generate({
      config: createConfig({ targets: ["codexcli"], retireTargets: ["agentsmd"] }),
      logger: createMockLogger(),
    });
    expect(await fileExists(agentsMd)).toBe(true);

    // The same retirement without a target that claims AGENTS.md removes it.
    await generateAgentsMd();
    await generate({
      config: createConfig({ targets: ["claudecode"], retireTargets: ["agentsmd"] }),
      logger: createMockLogger(),
    });
    expect(await fileExists(agentsMd)).toBe(false);
  });

  it("skips retirement in global mode", async () => {
    const stale = await writeStaleCursorRule();
    const logger = createMockLogger();

    await generate({
      config: createConfig({ global: true, retireTargets: ["cursor"] }),
      logger,
    });

    expect(await fileExists(stale)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("global mode"));
  });

  it("reports no change when a retired target left nothing behind", async () => {
    const logger = createMockLogger();
    const config = createConfig({ features: ["*"], retireTargets: ["cursor"] });
    await generate({ config, logger: createMockLogger() });

    const result = await generate({ config, logger });

    expect(result.hasDiff).toBe(false);
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("Deleted:"));
  });

  it("never removes a shared settings file the retired tool merges into", async () => {
    const settings = join(testDir, ".claude", "settings.json");
    const content = JSON.stringify({ hooks: {}, permissions: { allow: ["Bash(ls)"] } });
    await writeFileContent(settings, content);

    await generate({
      config: createConfig({
        targets: ["cursor"],
        features: ["hooks", "permissions", "ignore"],
        retireTargets: ["claudecode"],
      }),
      logger: createMockLogger(),
    });

    expect(await fileExists(settings)).toBe(true);
  });

  it("keeps a legacy root file that Rulesync never writes", async () => {
    const legacyRoot = join(testDir, ".claude", "CLAUDE.md");
    await writeFileContent(legacyRoot, "# Hand-written\n");

    await generate({
      config: createConfig({ targets: ["cursor"], retireTargets: ["claudecode"] }),
      logger: createMockLogger(),
    });

    expect(await fileExists(legacyRoot)).toBe(true);
  });

  it("skips retirement when a source file could not be read", async () => {
    const stale = await writeStaleCursorRule();
    await writeFileContent(join(testDir, ".rulesync", "mcp.json"), "{ not json");
    const logger = createMockLogger();

    const result = await generate({
      config: createConfig({ features: ["rules", "mcp"], retireTargets: ["cursor"] }),
      logger,
    });

    expect(result.sourceLoadFailed).toBe(true);
    expect(await fileExists(stale)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("could not be read"));
  });

  it("reports a diff in check mode while retired outputs remain", async () => {
    await generate({ config: createConfig({}), logger: createMockLogger() });
    const stale = await writeStaleCursorRule();

    const result = await generate({
      config: createConfig({ retireTargets: ["cursor"], check: true }),
      logger: createMockLogger(),
    });

    expect(result.hasDiff).toBe(true);
    expect(await fileExists(stale)).toBe(true);
  });

  it("retires skill directories", async () => {
    await writeFileContent(join(testDir, ".rulesync", "skills", "demo", "SKILL.md"), SKILL);
    await generate({
      config: createConfig({ targets: ["claudecode"], features: ["skills"] }),
      logger: createMockLogger(),
    });
    const skillFile = join(testDir, ".claude", "skills", "demo", "SKILL.md");
    expect(await fileExists(skillFile)).toBe(true);

    await generate({
      config: createConfig({
        targets: ["cursor"],
        features: ["skills"],
        retireTargets: ["claudecode"],
      }),
      logger: createMockLogger(),
    });

    expect(await fileExists(skillFile)).toBe(false);
    expect(await fileExists(join(testDir, ".cursor", "skills", "demo", "SKILL.md"))).toBe(true);
  });

  it("only retires the features of the run", async () => {
    const stale = await writeStaleCursorRule();
    const ignoreFile = join(testDir, ".cursorignore");
    await writeFileContent(ignoreFile, "secret\n");

    await generate({
      config: createConfig({ retireTargets: ["cursor"] }),
      logger: createMockLogger(),
    });

    expect(await fileExists(stale)).toBe(false);
    expect(await fileExists(ignoreFile)).toBe(true);
  });

  it("retires the target in every output root", async () => {
    const { testDir: secondRoot, cleanup: cleanupSecond } = await setupTestDirectory();
    try {
      const staleFirst = await writeStaleCursorRule();
      const staleSecond = await writeStaleCursorRule(secondRoot);

      await generate({
        config: createConfig({ outputRoots: [testDir, secondRoot], retireTargets: ["cursor"] }),
        logger: createMockLogger(),
      });

      expect(await fileExists(staleFirst)).toBe(false);
      expect(await fileExists(staleSecond)).toBe(false);
    } finally {
      await cleanupSecond();
    }
  });

  it("only reports what it would delete in dry-run mode", async () => {
    const stale = await writeStaleCursorRule();
    const logger = createMockLogger();

    const result = await generate({
      config: createConfig({ retireTargets: ["cursor"], dryRun: true }),
      logger,
    });

    expect(result.hasDiff).toBe(true);
    expect(await fileExists(stale)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(`[DRY RUN] Would delete: ${stale}`);
  });

  it("never retires anything in a run scoped below the configured targets", async () => {
    const stale = await writeStaleCursorRule();
    const logger = createMockLogger();

    const result = await generate({
      config: createConfig({
        targets: ["claudecode"],
        configFileTargets: ["claudecode", "copilot"],
        retireTargets: ["cursor"],
      }),
      logger,
    });

    expect(await fileExists(stale)).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Skipping retirement"));
  });

  it("never retires a target that is only left out of the targets list", async () => {
    const stale = await writeStaleCursorRule();

    await generate({ config: createConfig({ delete: true }), logger: createMockLogger() });

    expect(await fileExists(stale)).toBe(true);
  });
});

describe("Config retireTargets validation", () => {
  const base = {
    outputRoots: ["."],
    features: ["rules"],
    verbose: false,
    delete: false,
  } satisfies Partial<ConfigParams>;

  it("rejects a target that is still configured", () => {
    expect(() => new Config({ ...base, targets: ["cursor"], retireTargets: ["cursor"] })).toThrow(
      /still configured: cursor/,
    );
  });

  it("rejects a target the configuration file still declares", () => {
    expect(
      () =>
        new Config({
          ...base,
          targets: ["claudecode"],
          configFileTargets: ["claudecode", "cursor"],
          retireTargets: ["cursor"],
        }),
    ).toThrow(/still configured: cursor/);
  });

  it("rejects an unknown target", () => {
    expect(
      () =>
        new Config({
          ...base,
          targets: ["claudecode"],
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          retireTargets: ["nope" as "cursor"],
        }),
    ).toThrow(/Unknown target 'nope'/);
  });
});
