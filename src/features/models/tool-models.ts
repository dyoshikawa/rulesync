import {
  RULESYNC_MODELS_FILE_NAME,
  RULESYNC_MODELS_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncModels } from "./rulesync-models.js";

export type ToolModelsParams = AiFileParams;

export type ToolModelsFromRulesyncModelsParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncModels: RulesyncModels;
  logger?: Logger;
};

export type ToolModelsFromFileParams = Pick<
  AiFileFromFileParams,
  "outputRoot" | "validate" | "global"
> & {
  logger?: Logger;
};

export type ToolModelsForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export type ToolModelsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export abstract class ToolModels extends ToolFile {
  constructor({ ...rest }: ToolModelsParams) {
    super({
      ...rest,
      validate: true, // ToolModels runs subclass validation below when requested
    });

    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): ToolModelsSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncModels(): RulesyncModels;

  protected toRulesyncModelsDefault({
    fileContent = undefined,
    outputRoot = this.outputRoot,
  }: {
    fileContent?: string;
    outputRoot?: string;
  } = {}): RulesyncModels {
    const content = fileContent ?? this.fileContent;
    const { $schema: _, ...json } = JSON.parse(content);
    const withSchema = {
      $schema: RULESYNC_MODELS_SCHEMA_URL,
      ...json,
    };
    return new RulesyncModels({
      outputRoot,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_MODELS_FILE_NAME,
      fileContent: JSON.stringify(withSchema, null, 2),
    });
  }

  static async fromFile(_params: ToolModelsFromFileParams): Promise<ToolModels> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolModelsForDeletionParams): ToolModels {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncModels(
    _params: ToolModelsFromRulesyncModelsParams,
  ): ToolModels | Promise<ToolModels> {
    throw new Error("Please implement this method in the subclass.");
  }
}
