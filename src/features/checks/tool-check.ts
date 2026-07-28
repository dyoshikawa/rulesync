import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import type { Logger } from "../../utils/logger.js";
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
  /**
   * Set when a tool's checks all live in one file rather than in a directory of
   * per-check files. Consumers that would otherwise assume the whole directory
   * is rulesync's — the gitignore derivation, for one — use it to narrow to that
   * single file.
   */
  relativeFilePath?: string;
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

/**
 * Params of the optional `fromRulesyncChecks` static. A tool whose checks
 * collapse into a single shared file implements that instead of
 * {@link ToolCheck.fromRulesyncCheck}, because one output cannot be produced
 * from one check in isolation. It is deliberately absent from the base class so
 * the processor can detect which tools have it.
 */
export type ToolCheckFromRulesyncChecksParams = {
  rulesyncChecks: RulesyncCheck[];
  outputRoot?: string;
  relativeDirPath: string;
  global?: boolean;
  logger?: Logger;
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

  /**
   * Import direction of {@link fromRulesyncChecks}: one shared file can hold
   * many checks, so the default one-to-one mapping is widened here.
   */
  toRulesyncChecks(): RulesyncCheck[] {
    return [this.toRulesyncCheck()];
  }

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
