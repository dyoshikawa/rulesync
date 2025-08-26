import path from "node:path";

export type ValidationResult =
  | {
      success: true;
      error: undefined | null;
    }
  | {
      success: false;
      error: Error;
    };

export interface AiFileParams {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  validate?: boolean;
}

export interface AiFileFromFilePathParams {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  filePath: string;
}

export abstract class AiFile {
  /**
   * @example "."
   */
  protected readonly baseDir: string;

  /**
   * @example ".claude/agents"
   */
  protected readonly relativeDirPath: string;
  /**
   * @example "planner.md"
   */
  protected readonly relativeFilePath: string;

  protected readonly fileContent: string;

  constructor({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    fileContent,
    validate = true,
  }: AiFileParams) {
    this.baseDir = baseDir;
    this.relativeDirPath = relativeDirPath;
    this.relativeFilePath = relativeFilePath;
    this.fileContent = fileContent;

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static fromFilePath(_params: AiFileFromFilePathParams): AiFile {
    throw new Error("Please implement this method in the subclass.");
  }

  getFilePath(): string {
    return path.join(this.baseDir, this.relativeDirPath, this.relativeFilePath);
  }

  getFileContent(): string {
    return this.fileContent;
  }

  abstract validate(): ValidationResult;
}
