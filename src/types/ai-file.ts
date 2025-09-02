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

export type AiFileParams = {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  validate?: boolean;
};

export type AiFileFromFilePathParams = Omit<AiFileParams, "fileContent"> & {
  filePath: string;
};

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

  /**
   * Whole raw file content
   */
  protected fileContent: string;

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

  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<AiFile> {
    throw new Error("Please implement this method in the subclass.");
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getRelativeDirPath(): string {
    return this.relativeDirPath;
  }

  getRelativeFilePath(): string {
    return this.relativeFilePath;
  }

  getFilePath(): string {
    return path.join(this.baseDir, this.relativeDirPath, this.relativeFilePath);
  }

  getFileContent(): string {
    return this.fileContent;
  }

  getRelativePathFromCwd(): string {
    return path.join(this.relativeDirPath, this.relativeFilePath);
  }

  setFileContent(newFileContent: string): void {
    this.fileContent = newFileContent;
  }

  abstract validate(): ValidationResult;
}
