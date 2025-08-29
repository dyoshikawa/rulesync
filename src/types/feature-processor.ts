import { writeFileContent } from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class FeatureProcessor {
  protected readonly baseDir: string;

  constructor({ baseDir = process.cwd() }: { baseDir?: string }) {
    this.baseDir = baseDir;
  }

  abstract loadRulesyncFiles(): Promise<RulesyncFile[]>;

  abstract loadToolFiles(): Promise<ToolFile[]>;

  abstract convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]>;

  abstract convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]>;

  /**
   * Return tool targets that this feature supports.
   */
  static getToolTargets(): ToolTarget[] {
    throw new Error("Not implemented");
  }

  /**
   * Once converted to rulesync/tool files, write them to the filesystem.
   * Returns the number of files written.
   */
  async writeAiFiles(aiFiles: AiFile[]): Promise<number> {
    const writePromises = aiFiles.map(async (aiFile) => {
      await writeFileContent(aiFile.getFilePath(), aiFile.getFileContent());
    });

    await Promise.all(writePromises);

    return aiFiles.length;
  }
}
