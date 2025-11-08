import path, { relative, resolve } from "node:path";

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
  global?: boolean;
};

export type AiFileFromFileParams = Pick<
  AiFileParams,
  "baseDir" | "validate" | "relativeFilePath" | "global"
>;
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

  /**
   * @example true
   */
  protected readonly global: boolean;

  constructor({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    fileContent,
    validate = true,
    global = false,
  }: AiFileParams) {
    this.baseDir = baseDir;
    this.relativeDirPath = relativeDirPath;
    this.relativeFilePath = relativeFilePath;
    this.fileContent = fileContent;
    this.global = global;

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static async fromFile(_params: AiFileFromFileParams): Promise<AiFile> {
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
    const fullPath = path.join(this.baseDir, this.relativeDirPath, this.relativeFilePath);

    // Security check: ensure the final path doesn't escape baseDir via path traversal
    // This prevents attacks like: new AiFile({ relativeDirPath: "../../etc", ... })
    const resolvedFull = resolve(fullPath);
    const resolvedBase = resolve(this.baseDir);
    const rel = relative(resolvedBase, resolvedFull);

    // Check if the resolved path is outside baseDir
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes baseDir. ` +
          `baseDir="${this.baseDir}", relativeDirPath="${this.relativeDirPath}", ` +
          `relativeFilePath="${this.relativeFilePath}"`,
      );
    }

    return fullPath;
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
