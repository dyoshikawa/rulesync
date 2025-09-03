import { AiFile, AiFileParams } from "./ai-file.js";

export type RulesyncFileParams = AiFileParams;

export type RulesyncFileFromFileParams = {
  relativeFilePath: string;
  validate?: boolean;
};

export abstract class RulesyncFile extends AiFile {
  static async fromFile(_params: RulesyncFileFromFileParams): Promise<RulesyncFile> {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFileLegacy(_params: RulesyncFileFromFileParams): Promise<RulesyncFile> {
    throw new Error("Please implement this method in the subclass.");
  }
}
