import { logger } from "../../utils/logger.js";

/**
 * Show backward compatibility warning for commands without --features option
 * @param commandName The name of the command (e.g., "generate", "import")
 * @param exampleCommand Example command with --features option
 */
export function showBackwardCompatibilityWarning(
  commandName: string,
  exampleCommand: string,
): void {
  const yellow = "\x1b[33m";
  const gray = "\x1b[90m";
  const cyan = "\x1b[36m";
  const reset = "\x1b[0m";

  logger.warn(
    `\n${yellow}⚠️  Warning: No --features option specified.${reset}\n` +
      `${gray}Currently ${commandName} all features for backward compatibility.${reset}\n` +
      `${gray}In future versions, this behavior may change.${reset}\n` +
      `${gray}Please specify --features explicitly:${reset}\n` +
      `${cyan}  ${exampleCommand}${reset}\n` +
      `${gray}Or use --features * to ${commandName.replace("ing", "")} all features.${reset}\n`,
  );
}
