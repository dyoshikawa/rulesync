import type { ConfigResolverResolveParams } from "../../config/config-resolver.js";

import { importFrom } from "../../lib/import.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

export type ImportOptions = Omit<ConfigResolverResolveParams, "delete" | "baseDirs">;

export async function importCommand(options: ImportOptions): Promise<void> {
  logger.configure({
    verbose: options.verbose ?? false,
    silent: options.silent ?? false,
  });

  try {
    const totalImported = await importFrom(options);

    if (totalImported > 0) {
      logger.success(`Imported ${totalImported} file(s)`);
    }
  } catch (error) {
    logger.error(`❌ ${formatError(error)}`);
    process.exit(1);
  }
}
