import { z } from "zod/mini";
import { Processor } from "../types/processor.js";
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
    this.toolTarget = SubagentsProcessorToolTargetSchema.parse(toolTarget);
  }

  async writeToolSubagentsFromRulesyncSubagents(
    rulesyncSubagents: RulesyncSubagent[],
  ): Promise<void> {
    const toolSubagents = rulesyncSubagents.map((rulesyncSubagent) => {
      switch (this.toolTarget) {
        case "claudecode":
          return ClaudecodeSubagent.fromRulesyncSubagent({
            baseDir: this.baseDir,
            relativeDirPath: ".claude/agents",
            rulesyncSubagent: rulesyncSubagent,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    await this.writeAiFiles(toolSubagents);
  }

  async writeRulesyncSubagentsFromToolSubagents(toolSubagents: ToolSubagent[]): Promise<void> {
    const rulesyncSubagents = toolSubagents.map((toolSubagent) => {
      return toolSubagent.toRulesyncSubagent();
    });

    await this.writeAiFiles(rulesyncSubagents);
  }
}
