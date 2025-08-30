import { AiFile, AiFileFromFilePathParams, AiFileParams } from "./ai-file.js";

export type RulesyncFileParams = AiFileParams;

export abstract class RulesyncFile extends AiFile {
  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<RulesyncFile> {
    throw new Error("Please implement this method in the subclass.");
  }
}
