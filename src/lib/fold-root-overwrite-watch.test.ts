import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexcliRule } from "../features/rules/codexcli-rule.js";
import { PiRule } from "../features/rules/pi-rule.js";
import { ToolRule } from "../features/rules/tool-rule.js";
import { ZoocodeRule } from "../features/rules/zoocode-rule.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { createFoldRootOverwriteWatch } from "./fold-root-overwrite-watch.js";

const ROOT_ONLY = "# Root\n";
const FOLDED = "# Root\n\n# Style\n";

function rootRule({
  Rule,
  content,
  outputRoot = resolve("out"),
}: {
  Rule: typeof CodexcliRule | typeof PiRule | typeof ZoocodeRule;
  content: string;
  outputRoot?: string;
}): ToolRule {
  return new Rule({
    outputRoot,
    relativeDirPath: ".",
    relativeFilePath: "AGENTS.md",
    fileContent: content,
    root: true,
    validate: false,
  });
}

describe("createFoldRootOverwriteWatch", () => {
  it("should warn when a modular target overwrites the file a fold target folded into", () => {
    const logger = createMockLogger();
    const watch = createFoldRootOverwriteWatch({ logger });

    watch.observe({
      toolTarget: "codexcli",
      toolFiles: [rootRule({ Rule: CodexcliRule, content: FOLDED })],
    });
    watch.observe({
      toolTarget: "zoocode",
      toolFiles: [rootRule({ Rule: ZoocodeRule, content: ROOT_ONLY })],
    });
    expect(logger.warn).not.toHaveBeenCalled();

    watch.report();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = String(logger.warn.mock.calls[0]?.[0]);
    expect(message).toContain("Target 'zoocode' overwrites out/AGENTS.md");
    expect(message).toContain("list 'codexcli' after 'zoocode'");
  });

  it("should stay quiet when the fold target comes last", () => {
    const logger = createMockLogger();
    const watch = createFoldRootOverwriteWatch({ logger });

    watch.observe({
      toolTarget: "zoocode",
      toolFiles: [rootRule({ Rule: ZoocodeRule, content: ROOT_ONLY })],
    });
    watch.observe({
      toolTarget: "codexcli",
      toolFiles: [rootRule({ Rule: CodexcliRule, content: FOLDED })],
    });
    watch.report();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should stay quiet when a later fold target wins the file back", () => {
    const logger = createMockLogger();
    const watch = createFoldRootOverwriteWatch({ logger });

    watch.observe({
      toolTarget: "codexcli",
      toolFiles: [rootRule({ Rule: CodexcliRule, content: FOLDED })],
    });
    watch.observe({
      toolTarget: "zoocode",
      toolFiles: [rootRule({ Rule: ZoocodeRule, content: ROOT_ONLY })],
    });
    watch.observe({
      toolTarget: "pi",
      toolFiles: [rootRule({ Rule: PiRule, content: FOLDED })],
    });
    watch.report();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should stay quiet when the overwrite carries the same content", () => {
    const logger = createMockLogger();
    const watch = createFoldRootOverwriteWatch({ logger });

    // A root rule with no non-root siblings folds into itself.
    watch.observe({
      toolTarget: "codexcli",
      toolFiles: [rootRule({ Rule: CodexcliRule, content: ROOT_ONLY })],
    });
    watch.observe({
      toolTarget: "zoocode",
      toolFiles: [rootRule({ Rule: ZoocodeRule, content: ROOT_ONLY })],
    });
    watch.report();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should compare output roots separately", () => {
    const logger = createMockLogger();
    const watch = createFoldRootOverwriteWatch({ logger });

    watch.observe({
      toolTarget: "codexcli",
      toolFiles: [rootRule({ Rule: CodexcliRule, content: FOLDED, outputRoot: resolve("a") })],
    });
    watch.observe({
      toolTarget: "zoocode",
      toolFiles: [rootRule({ Rule: ZoocodeRule, content: ROOT_ONLY, outputRoot: resolve("b") })],
    });
    watch.report();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should ignore non-root rules and files that are not rules", () => {
    const logger = createMockLogger();
    const watch = createFoldRootOverwriteWatch({ logger });

    watch.observe({
      toolTarget: "codexcli",
      toolFiles: [rootRule({ Rule: CodexcliRule, content: FOLDED })],
    });
    watch.observe({
      toolTarget: "zoocode",
      toolFiles: [
        new ZoocodeRule({
          outputRoot: resolve("out"),
          relativeDirPath: join(".roo", "rules"),
          relativeFilePath: "style.md",
          fileContent: "# Style\n",
          root: false,
          validate: false,
        }),
      ],
    });
    watch.report();

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
