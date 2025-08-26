import { z } from "zod/mini";
import { Processor } from "../types/processor.js";
import { writeFileContent } from "../utils/file.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

export const SubagentsProcessorToolTargetSchema = z.enum(["claudecode"]);

export type SubagentsProcessorToolTarget = z.infer<typeof SubagentsProcessorToolTargetSchema>;

export class SubagentsProcessor extends Processor {
  private readonly toolTarget: SubagentsProcessorToolTarget;

  constructor({
    baseDir,
    toolTarget,
  }: { baseDir: string; toolTarget: SubagentsProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = toolTarget;
  }

  async writeToolSubagentsFromRulesyncSubagents(
    rulesyncSubagents: RulesyncSubagent[],
  ): Promise<void> {
    const toolSubagents = rulesyncSubagents.map((rulesyncSubagent) => {
      switch (this.toolTarget) {
        case "claudecode":
          return ClaudecodeSubagent.fromRulesyncSubagent({
            ...rulesyncSubagent,
            relativeDirPath: ".claude/agents",
            relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
            rulesyncSubagent: rulesyncSubagent,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    writeFileContent(
      path.join(this.baseDir, "subagents", "tool-subagents.json"),
      JSON.stringify(toolSubagents, null, 2),
    );
  }

  writeRulesyncSubagentsFromToolSubagents(toolSubagents: ToolSubagent[]): {
    subagents: RulesyncSubagent[];
  } {
    return {
      subagents: [],
    };
  }
}
