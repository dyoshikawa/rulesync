import path, { relative, resolve } from "node:path";

import { toPosixPath } from "../utils/file.js";

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
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  validate?: boolean;
  global?: boolean;
};

export type AiFileFromFileParams = Pick<
  AiFileParams,
  "outputRoot" | "validate" | "relativeFilePath" | "global"
> & {
  relativeDirPath?: string;
};
export abstract class AiFile {
  /**
   * @example "."
   */
  protected readonly outputRoot: string;

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
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    fileContent,
    global = false,
  }: AiFileParams) {
    this.outputRoot = outputRoot;
    this.relativeDirPath = relativeDirPath;
    this.relativeFilePath = relativeFilePath;
    this.fileContent = fileContent;
    this.global = global;
  }

  static async fromFile(_params: AiFileFromFileParams): Promise<AiFile> {
    throw new Error("Please implement this method in the subclass.");
  }

  getOutputRoot(): string {
    return this.outputRoot;
  }

  getRelativeDirPath(): string {
    return this.relativeDirPath;
  }

  getRelativeFilePath(): string {
    return this.relativeFilePath;
  }

  getFilePath(): string {
    const fullPath = path.join(this.outputRoot, this.relativeDirPath, this.relativeFilePath);

    // Security check: ensure the final path doesn't escape outputRoot via path traversal
    // This prevents attacks like: new AiFile({ relativeDirPath: "../../etc", ... })
    const resolvedFull = resolve(fullPath);
    const resolvedBase = resolve(this.outputRoot);
    const rel = relative(resolvedBase, resolvedFull);

    // Check if the resolved path is outside outputRoot
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes outputRoot. ` +
          `outputRoot="${this.outputRoot}", relativeDirPath="${this.relativeDirPath}", ` +
          `relativeFilePath="${this.relativeFilePath}"`,
      );
    }

    return fullPath;
  }

  getFileContent(): string {
    return this.fileContent;
  }

  /**
   * Returns the relative path from CWD with POSIX separators for consistent cross-platform output.
   */
  getRelativePathFromCwd(): string {
    return toPosixPath(path.join(this.relativeDirPath, this.relativeFilePath));
  }

  setFileContent(newFileContent: string): void {
    this.fileContent = newFileContent;
  }

  /**
   * Returns whether this file can be deleted by rulesync.
   * Override in subclasses that should not be deleted (e.g., user-managed config files).
   */
  isDeletable(): boolean {
    return true;
  }

  abstract validate(): ValidationResult;
}
