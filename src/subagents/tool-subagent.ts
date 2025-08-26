import { AiFile } from "../types/ai-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

export abstract class ToolSubagent extends AiFile {
  static fromFilePath(_params: {
    baseDir: string;
    relativeDirPath: string;
    relativeFilePath: string;
    filePath: string;
  }): ToolSubagent {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncSubagent(): RulesyncSubagent;
  abstract fromRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): ToolSubagent;
}
