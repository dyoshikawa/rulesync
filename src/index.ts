import type { Feature } from "./types/features.js";
import type { ToolTarget } from "./types/tool-targets.js";

import { ConfigResolver } from "./config/config-resolver.js";
import { checkRulesyncDirExists, generate as coreGenerate } from "./lib/generate.js";
import { importFromTool as coreImportFromTool } from "./lib/import.js";
import { logger } from "./utils/logger.js";

export type { Feature } from "./types/features.js";
export type { ToolTarget } from "./types/tool-targets.js";
export { ALL_FEATURES } from "./types/features.js";
export { ALL_TOOL_TARGETS } from "./types/tool-targets.js";
export type { GenerateResult } from "./lib/generate.js";
export type { ImportResult } from "./lib/import.js";

export type GenerateOptions = {
  targets?: ToolTarget[];
  features?: Feature[];
  baseDirs?: string[];
  configPath?: string;
  verbose?: boolean;
  silent?: boolean;
  delete?: boolean;
  global?: boolean;
  simulateCommands?: boolean;
  simulateSubagents?: boolean;
  simulateSkills?: boolean;
  dryRun?: boolean;
  check?: boolean;
};

export type ImportOptions = {
  target: ToolTarget;
  features?: Feature[];
  configPath?: string;
  verbose?: boolean;
  silent?: boolean;
  global?: boolean;
};

export async function generate(options: GenerateOptions = {}) {
  const { silent = true, verbose = false, ...rest } = options;
  logger.configure({ verbose, silent });

  const config = await ConfigResolver.resolve({
    ...rest,
    verbose,
    silent,
  });

  for (const baseDir of config.getBaseDirs()) {
    if (!(await checkRulesyncDirExists({ baseDir }))) {
      throw new Error(".rulesync directory not found. Run 'rulesync init' first.");
    }
  }

  return coreGenerate({ config });
}

export async function importFromTool(options: ImportOptions) {
  const { target, silent = true, verbose = false, ...rest } = options;
  logger.configure({ verbose, silent });

  const config = await ConfigResolver.resolve({
    ...rest,
    targets: [target],
    verbose,
    silent,
  });

  return coreImportFromTool({ config, tool: target });
}
