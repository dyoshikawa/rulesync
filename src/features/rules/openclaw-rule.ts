import {
  OPENCLAW_RULE_FILE_NAME,
  OPENCLAW_WORKSPACE_DIR_PATH,
} from "../../constants/openclaw-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleSettablePaths } from "./tool-rule.js";

/**
 * Rule generator for OpenClaw, the always-on assistant gateway.
 *
 * OpenClaw injects the agent workspace's `AGENTS.md`
 * (`~/.openclaw/workspace/AGENTS.md` by default) into every session, and when
 * a session runs from another folder or a managed worktree it appends that
 * folder's `AGENTS.md` as project context. OpenClaw documents no
 * per-directory walk, so there is no nested rules surface to emit and rulesync's
 * topic-based non-root rules are folded into the single root file by the
 * RulesProcessor (`nonRoot` is `undefined`). The sibling persona files
 * (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`) are left alone.
 *
 * @see https://docs.openclaw.ai/concepts/system-prompt
 * @see https://docs.openclaw.ai/concepts/agent-workspace
 */
export type OpenclawRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class OpenclawRule extends SingleRootFileRule {
  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): OpenclawRuleSettablePaths {
    return {
      root: {
        // The execution-folder file sits at the project root; the agent
        // workspace file sits under the home directory, which the processor
        // reaches by supplying the home directory as outputRoot.
        relativeDirPath: global ? OPENCLAW_WORKSPACE_DIR_PATH : ".",
        relativeFilePath: OPENCLAW_RULE_FILE_NAME,
      },
    };
  }

  protected static override isRootFilePath({
    relativeDirPath,
    relativeFilePath,
  }: {
    relativeDirPath: string;
    relativeFilePath: string;
    global: boolean;
  }): boolean {
    return (
      relativeFilePath === OPENCLAW_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === OPENCLAW_WORKSPACE_DIR_PATH)
    );
  }

  protected static override readonly toolTarget = "openclaw";
}
