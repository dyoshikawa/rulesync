import type { CommandOutput, ParsedCommand } from "../../types/commands.js";
import { ClaudeCodeCommandGenerator } from "./claudecode.js";
import { GeminiCliCommandGenerator } from "./geminicli.js";

export interface CommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput;
  getOutputPath(filename: string, baseDir: string): string;
}

export const commandGenerators: Record<string, CommandGenerator> = {
  claudecode: new ClaudeCodeCommandGenerator(),
  geminicli: new GeminiCliCommandGenerator(),
};

export function getCommandGenerator(tool: string): CommandGenerator | undefined {
  return commandGenerators[tool];
}
