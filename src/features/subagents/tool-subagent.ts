import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

export type ToolSubagentFromRulesyncSubagentParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncSubagent: RulesyncSubagent;
  global?: boolean;
};

export type ToolSubagentSettablePaths = {
  relativeDirPath: string;
};

export type ToolSubagentFromFileParams = AiFileFromFileParams & {
  global?: boolean;
};

export type ToolSubagentForDeletionParams = {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};
export abstract class ToolSubagent extends ToolFile {
  static getSettablePaths(): ToolSubagentSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFile(_params: ToolSubagentFromFileParams): Promise<ToolSubagent> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params: ToolSubagentForDeletionParams): ToolSubagent {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncSubagent(_params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncSubagent(): RulesyncSubagent;

  static isTargetedByRulesyncSubagent(_rulesyncSubagent: RulesyncSubagent): boolean {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static isTargetedByRulesyncSubagentDefault({
    rulesyncSubagent,
    toolTarget,
  }: {
    rulesyncSubagent: RulesyncSubagent;
    toolTarget: ToolTarget;
  }): boolean {
    const targets = rulesyncSubagent.getFrontmatter().targets;
    if (!targets) {
      return true;
    }

    if (targets.includes("*")) {
      return true;
    }

    if (targets.includes(toolTarget)) {
      return true;
    }

    return false;
  }

  protected static filterToolSpecificSection(
    rawSection: Record<string, unknown>,
    excludeFields: string[],
  ): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawSection)) {
      if (!excludeFields.includes(key)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
}
