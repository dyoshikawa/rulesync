import type { ConfigResolverResolveParams } from "../../config/config-resolver.js";

import { generate, type GenerateResult } from "../../lib/generate.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

export type GenerateOptions = ConfigResolverResolveParams;

function formatResultBreakdown(result: GenerateResult): string {
  const parts: string[] = [];
  if (result.rules > 0) parts.push(`${result.rules} rules`);
  if (result.ignore > 0) parts.push(`${result.ignore} ignore files`);
  if (result.mcp > 0) parts.push(`${result.mcp} MCP files`);
  if (result.commands > 0) parts.push(`${result.commands} commands`);
  if (result.subagents > 0) parts.push(`${result.subagents} subagents`);
  if (result.skills > 0) parts.push(`${result.skills} skills`);
  return parts.join(" + ");
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  logger.configure({
    verbose: options.verbose ?? false,
    silent: options.silent ?? false,
  });
  logger.info("Generating files...");

  try {
    const result = await generate(options);

    if (result.total === 0) {
      logger.warn("⚠️  No files generated for enabled features");
      return;
    }

    const breakdown = formatResultBreakdown(result);
    if (breakdown) {
      logger.success(`🎉 All done! Generated ${result.total} file(s) total (${breakdown})`);
    } else {
      logger.success(`🎉 All done! Generated ${result.total} file(s) total`);
    }
  } catch (error) {
    logger.error(`❌ ${formatError(error)}`);
    process.exit(1);
  }
}
