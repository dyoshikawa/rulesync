import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { RulesyncCheck } from "./rulesync-check.js";

export type ToolCheckFromRulesyncCheckParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncCheck: RulesyncCheck;
  global?: boolean;
};

export type ToolCheckSettablePaths = {
  relativeDirPath: string;
};

export type ToolCheckFromFileParams = AiFileFromFileParams & {
  global?: boolean;
};

export type ToolCheckForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export abstract class ToolCheck extends ToolFile {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFile(_params: ToolCheckFromFileParams): Promise<ToolCheck> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params: ToolCheckForDeletionParams): ToolCheck {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): ToolCheck {
    throw new Error("Please implement this method in the subclass.");
  }

  static async getAuxiliaryFiles(_params: {
    toolChecks: ToolCheck[];
    outputRoot?: string;
    global?: boolean;
  }): Promise<ToolFile[]> {
    return [];
  }

  abstract toRulesyncCheck(): RulesyncCheck;

  static isTargetedByRulesyncCheck(_rulesyncCheck: RulesyncCheck): boolean {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static isTargetedByRulesyncCheckDefault({
    rulesyncCheck,
    toolTarget,
  }: {
    rulesyncCheck: RulesyncCheck;
    toolTarget: ToolTarget;
  }): boolean {
    const targets = rulesyncCheck.getFrontmatter().targets;
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
