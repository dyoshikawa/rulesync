import path, { basename, join, relative, resolve } from "node:path";
import { findFilesByGlobs, readFileBuffer } from "../utils/file.js";

export type ValidationResult =
  | {
      success: true;
      error: undefined | null;
    }
  | {
      success: false;
      error: Error;
    };

export type AiDirFile = {
  relativeFilePathToDirPath: string;
  fileBuffer: Buffer;
};

export type AiDirParams = {
  baseDir?: string;
  relativeDirPath: string;
  dirName: string;
  mainFile?: {
    name: string;
    body: string;
    frontmatter?: Record<string, unknown>;
  };
  otherFiles?: AiDirFile[];
  global?: boolean;
};

export type AiDirFromDirParams = Pick<
  AiDirParams,
  "baseDir" | "relativeDirPath" | "dirName" | "global"
>;

export abstract class AiDir {
  /**
   * @example "."
   */
  protected readonly baseDir: string;

  /**
   * @example ".rulesync/skills"
   */
  protected readonly relativeDirPath: string;

  /**
   * @example "my-skill"
   */
  protected readonly dirName: string;

  /**
   * Optional main file with frontmatter support
   */
  protected mainFile?: {
    name: string;
    body: string;
    frontmatter?: Record<string, unknown>;
  };

  /**
   * Additional files in the directory
   */
  protected otherFiles: AiDirFile[];

  /**
   * @example false
   */
  protected readonly global: boolean;

  constructor({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    mainFile,
    otherFiles = [],
    global = false,
  }: AiDirParams) {
    // Security check: ensure dirName doesn't contain path separators
    if (dirName.includes(path.sep) || dirName.includes("/") || dirName.includes("\\")) {
      throw new Error(`Directory name cannot contain path separators: dirName="${dirName}"`);
    }

    this.baseDir = baseDir;
    this.relativeDirPath = relativeDirPath;
    this.dirName = dirName;
    this.mainFile = mainFile;
    this.otherFiles = otherFiles;
    this.global = global;
  }

  static async fromDir(_params: AiDirFromDirParams): Promise<AiDir> {
    throw new Error("Please implement this method in the subclass.");
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getRelativeDirPath(): string {
    return this.relativeDirPath;
  }

  getDirName(): string {
    return this.dirName;
  }

  getDirPath(): string {
    const fullPath = path.join(this.baseDir, this.relativeDirPath, this.dirName);

    // Security check: ensure the final path doesn't escape baseDir via path traversal
    // This prevents attacks like: new AiDir({ relativeDirPath: "../../etc", ... })
    const resolvedFull = resolve(fullPath);
    const resolvedBase = resolve(this.baseDir);
    const rel = relative(resolvedBase, resolvedFull);

    // Check if the resolved path is outside baseDir
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes baseDir. ` +
          `baseDir="${this.baseDir}", relativeDirPath="${this.relativeDirPath}", ` +
          `dirName="${this.dirName}"`,
      );
    }

    return fullPath;
  }

  getMainFile():
    | {
        name: string;
        body: string;
        frontmatter?: Record<string, unknown>;
      }
    | undefined {
    return this.mainFile;
  }

  getOtherFiles(): AiDirFile[] {
    return this.otherFiles;
  }

  getRelativePathFromCwd(): string {
    return path.join(this.relativeDirPath, this.dirName);
  }

  getGlobal(): boolean {
    return this.global;
  }

  setMainFile(name: string, body: string, frontmatter?: Record<string, unknown>): void {
    this.mainFile = { name, body, frontmatter };
  }

  /**
   * Recursively collects all files from a directory, excluding the specified main file.
   * This is a common utility for loading additional files alongside the main file.
   *
   * @param baseDir - The base directory path
   * @param relativeDirPath - The relative path to the directory containing the skill
   * @param dirName - The name of the directory
   * @param excludeFileName - The name of the file to exclude (typically the main file)
   * @returns Array of files with their relative paths and buffers
   */
  protected static async collectOtherFiles(
    baseDir: string,
    relativeDirPath: string,
    dirName: string,
    excludeFileName: string,
  ): Promise<AiDirFile[]> {
    const dirPath = join(baseDir, relativeDirPath, dirName);
    const glob = join(dirPath, "**", "*");
    const filePaths = await findFilesByGlobs(glob, { fileOnly: true });
    const filteredPaths = filePaths.filter((filePath) => basename(filePath) !== excludeFileName);

    const files: AiDirFile[] = await Promise.all(
      filteredPaths.map(async (filePath) => {
        const fileBuffer = await readFileBuffer(filePath);
        return {
          relativeFilePathToDirPath: relative(dirPath, filePath),
          fileBuffer,
        };
      }),
    );

    return files;
  }

  abstract validate(): ValidationResult;
}
