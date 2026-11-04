import { AGENTSMD_COMMANDS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { SimulatedCommand } from "./simulated-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

export class AgentsmdCommand extends SimulatedCommand {
  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: AGENTSMD_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "agentsmd";
  }
}
