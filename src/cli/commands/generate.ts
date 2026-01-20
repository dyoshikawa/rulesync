import type { ConfigResolverResolveParams } from "../../config/config-resolver.js";

import { generate } from "../../lib/generate.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

export type GenerateOptions = ConfigResolverResolveParams;

export async function generateCommand(options: GenerateOptions): Promise<void> {
  logger.setVerbose(options.verbose ?? false);
  logger.info("Generating files...");

  try {
    const totalGenerated = await generate(options);

    if (totalGenerated === 0) {
      logger.warn("⚠️  No files generated for enabled features");
      return;
    }

    logger.success(`🎉 All done! Generated ${totalGenerated} file(s) total`);
  } catch (error) {
    logger.error(`❌ ${formatError(error)}`);
    process.exit(1);
  }
}
