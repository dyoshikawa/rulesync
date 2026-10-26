import { DSH_DIR } from "../../constants/dsh-paths.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";
import { ToolRule, ToolRuleBuildLocalRootFileParams } from "./tool-rule.js";

/**
 * DeepSeek Harness (`dsh`) rules.
 *
 * Project scope writes the root `AGENTS.md` plus nested `<dir>/AGENTS.md`
 * files — the project chain `dsh-agent-instructions` loads from the `.git`
 * root down to the session cwd, broad to specific, so a per-directory file
 * applies only while working under that directory. A `localRoot` rule goes to
 * the project-root `AGENTS.local.md`, the additive local overlay the project
 * chain loads beside each `AGENTS.md`. Global scope writes the user-global
 * `~/.dsh/AGENTS.md` (`$DSH_HOME` default), which the harness reads as a single
 * root file with no `.local.md` overlay, so non-root rules fold into it. The
 * harness also reads a shared `~/.agents/AGENTS.md` (`$DSH_AGENTS_HOME`) after
 * it, which rulesync never writes.
 *
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
 */
export class DshRule extends NestedAgentsmdRule {
  /**
   * Build this tool's separate personal local-root file (`localRootMode:
   * "separate-local-file"`), for generation and import. See
   * {@link ToolRuleBuildLocalRootFileParams}.
   */
  static buildLocalRootFile({
    outputRoot,
    fileName,
    body,
    relativeDirPath,
    localRoot,
  }: ToolRuleBuildLocalRootFileParams): ToolRule {
    // Read from the working directory root, next to the shared root file (`AGENTS.md`), as
    // plain markdown; there is no tool directory to put it in.
    return new DshRule({
      outputRoot,
      relativeDirPath: relativeDirPath ?? ".",
      relativeFilePath: fileName,
      fileContent: body,
      validate: true,
      root: true,
      localRoot,
    });
  }

  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: DSH_DIR, toolTarget: "dsh" };
  }
}
