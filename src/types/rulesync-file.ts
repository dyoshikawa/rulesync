import { AiFile, AiFileFromFilePathParams, AiFileParams } from "./ai-file.js";

export interface RulesyncFileParams extends AiFileParams {
  body: string;
}

export abstract class RulesyncFile extends AiFile {
  protected readonly body: string;

  constructor({ body, ...rest }: RulesyncFileParams) {
    super({
      ...rest,
    });
    this.body = body;
  }

  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<RulesyncFile> {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract getFrontmatter(): Record<string, unknown>;

  getBody(): string {
    return this.body;
  }
}
