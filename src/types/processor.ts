import { writeFileContent } from "../utils/file.js";
import { AiFile } from "./ai-file.js";

export abstract class Processor {
  protected readonly baseDir: string;

  constructor({ baseDir }: { baseDir: string }) {
    this.baseDir = baseDir;
  }

  protected async writeAiFiles(aiFiles: AiFile[]): Promise<void> {
    // 並列処理でパフォーマンスを改善
    await Promise.all(
      aiFiles.map((aiFile) => writeFileContent(aiFile.getFilePath(), aiFile.getFileContent())),
    );
  }
}
