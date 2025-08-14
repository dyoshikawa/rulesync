import { join } from "node:path";
import { getCommandGenerator } from "../generators/commands/index.js";
import type { CommandOutput } from "../types/commands.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { fileExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { parseCommandsFromDirectory } from "./command-parser.js";

export async function generateCommands(
  projectRoot: string,
  baseDir: string | undefined,
  targets: ToolTarget[],
): Promise<CommandOutput[]> {
  const commandsDir = join(projectRoot, ".rulesync", "commands");

  // Check if commands directory exists
  if (!(await fileExists(commandsDir))) {
    // No commands directory, skip silently
    return [];
  }

  // Parse commands from directory
  const commands = await parseCommandsFromDirectory(commandsDir);

  if (commands.length === 0) {
    return [];
  }

  const outputs: CommandOutput[] = [];
  const outputDir = baseDir || projectRoot;

  // Filter targets to only those that support commands
  const supportedTargets = targets.filter((target) =>
    ["claudecode", "geminicli", "roo"].includes(target),
  );

  // Generate command files for each supported target
  for (const target of supportedTargets) {
    const generator = getCommandGenerator(target);

    if (!generator) {
      continue;
    }

    for (const command of commands) {
      try {
        const output = generator.generate(command, outputDir);
        outputs.push(output);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          `Failed to generate ${target} command for ${command.filename}: ${errorMessage}`,
        );
      }
    }
  }

  return outputs;
}
