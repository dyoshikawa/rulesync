import {
  GITLABDUO_COMMANDS_DIR,
  GITLABDUO_GLOBAL_COMMANDS_DIR,
} from "../../constants/gitlabduo-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { SimulatedCommand } from "./simulated-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * GitLab Duo CLI custom slash commands are Markdown files named after the
 * command, with an optional `description` in YAML frontmatter. The project
 * directory is the cross-tool `.agents/commands/`; the user directory is
 * `~/.gitlab/duo/commands/`. The scan is flat, and text typed after the command
 * is appended to the prompt (there are no argument placeholders).
 *
 * The file format is the same `description`-only shape `AgentsmdCommand`
 * writes, so it reuses that base class, but this adapter is native: it
 * supports the user scope and imports back into rulesync.
 *
 * @see https://docs.gitlab.com/user/gitlab_duo_cli/customize/
 */
export class GitlabduoCommand extends SimulatedCommand {
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: global ? GITLABDUO_GLOBAL_COMMANDS_DIR : GITLABDUO_COMMANDS_DIR,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "gitlabduo";
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const { description } = this.getFrontmatter();
    return {
      targets: ["*"],
      ...(typeof description === "string" && { description }),
    };
  }
}
