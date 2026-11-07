import { describe, expect, it } from "vite-plus/test";

import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import type { RulesyncSourceConsumer } from "./rulesync-source-consumer.js";

/**
 * The orphan sweep follows in-root links only in global scope (a dotfiles
 * checkout linked into the home directory). A processor that forgot to
 * report its scope would silently stop sweeping such a setup, so every
 * file-feature processor is pinned here.
 */
describe("sweepsThroughInRootLinks", () => {
  const factories: Array<[string, (global: boolean) => RulesyncSourceConsumer]> = [
    [
      "rules",
      (global) =>
        new RulesProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
    [
      "commands",
      (global) =>
        new CommandsProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
    [
      "subagents",
      (global) =>
        new SubagentsProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
    [
      "checks",
      (global) =>
        new ChecksProcessor({ toolTarget: "augmentcode", global, logger: createMockLogger() }),
    ],
    [
      "hooks",
      (global) =>
        new HooksProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
    [
      "mcp",
      (global) =>
        new McpProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
    [
      "permissions",
      (global) =>
        new PermissionsProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
    [
      "ignore",
      (global) => new IgnoreProcessor({ toolTarget: "cursor", global, logger: createMockLogger() }),
    ],
    [
      "skills",
      (global) =>
        new SkillsProcessor({ toolTarget: "claudecode", global, logger: createMockLogger() }),
    ],
  ];

  it.each(factories)("%s follows in-root links only in global scope", (_name, create) => {
    const answer = (processor: RulesyncSourceConsumer): boolean =>
      (processor as unknown as { sweepsThroughInRootLinks(): boolean }).sweepsThroughInRootLinks();
    expect(answer(create(true))).toBe(true);
    expect(answer(create(false))).toBe(false);
  });
});
