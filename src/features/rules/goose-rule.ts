import { GOOSE_GLOBAL_DIR, GOOSE_RULE_FILE_NAME } from "../../constants/goose-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleParams, ToolRuleSettablePaths, ToolRuleSettablePathsGlobal } from "./tool-rule.js";

export type GooseRuleParams = ToolRuleParams;

export type GooseRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export type GooseRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Represents a rule file for Goose.
 *
 * Goose loads instruction context only from the `.goosehints` / `AGENTS.md`
 * family (the configured `CONTEXT_FILE_NAMES`), discovered by walking from the
 * working directory up to the repository root plus any nested directories Goose
 * touches during a session. The separate `.goose/memories/` tree is the Memory
 * extension's storage and is NOT auto-loaded as session context.
 * (Verified against the official docs:
 * https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/)
 *
 * rulesync's topic-based non-root rules have no project subdirectory to map onto,
 * so writing them under `.goose/memories/` made them effectively invisible to
 * Goose. Their bodies are instead folded into the single root `.goosehints` by
 * the RulesProcessor (there is no separate non-root output location — `nonRoot`
 * is `undefined`). This mirrors the warp and deepagents targets.
 *
 * Goose uses plain markdown files (.goosehints) without frontmatter.
 *
 * Global scope emits only `~/.config/goose/.goosehints`. Goose v1.41.0 (PR
 * aaif-goose/goose#9736) additionally loads the vendor-neutral
 * `~/.agents/AGENTS.md` alongside the config-dir hints, but rulesync
 * deliberately does not emit that shared path from the goose target: the
 * config-dir hints remain fully loaded (no capability loss), and the
 * cross-tool `~/.agents/AGENTS.md` is already written by targets that own it
 * (e.g. cline in global mode) — a second writer would need cross-target
 * shared-file coordination for zero gain (decision recorded in issue #2207).
 */
export class GooseRule extends SingleRootFileRule {
  static getSettablePaths({
    global,
  }: {
    global?: boolean;
  } = {}): GooseRuleSettablePaths | GooseRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: GOOSE_GLOBAL_DIR,
          relativeFilePath: GOOSE_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: GOOSE_RULE_FILE_NAME,
      },
    };
  }

  protected static override isRootFilePath({
    relativeDirPath,
    relativeFilePath,
    global,
  }: {
    relativeDirPath: string;
    relativeFilePath: string;
    global: boolean;
  }): boolean {
    const paths = this.getSettablePaths({ global });
    return (
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === "." || relativeDirPath === paths.root.relativeDirPath)
    );
  }

  protected static override readonly toolTarget = "goose";
}
