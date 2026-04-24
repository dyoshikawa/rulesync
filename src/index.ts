import { ConfigResolver } from "./config/config-resolver.js";
import { convertFromTool as coreConvertFromTool, type ConvertResult } from "./lib/convert.js";
import {
  checkRulesyncDirExists,
  generate as coreGenerate,
  type GenerateResult,
} from "./lib/generate.js";
import { importFromTool as coreImportFromTool, type ImportResult } from "./lib/import.js";
import type { Feature } from "./types/features.js";
import type { ToolTarget } from "./types/tool-targets.js";
import { ConsoleLogger } from "./utils/logger.js";

export type { Feature } from "./types/features.js";
export type { ToolTarget } from "./types/tool-targets.js";
export { ALL_FEATURES } from "./types/features.js";
export { ALL_TOOL_TARGETS } from "./types/tool-targets.js";
export type { GenerateResult } from "./lib/generate.js";
export type { ImportResult } from "./lib/import.js";
export type { ConvertResult } from "./lib/convert.js";

type BaseOptions = {
  configPath?: string;
  verbose?: boolean;
  silent?: boolean;
  global?: boolean;
};

export type GenerateOptions = BaseOptions & {
  targets?: ToolTarget[];
  features?: Feature[];
  baseDirs?: string[];
  delete?: boolean;
  simulateCommands?: boolean;
  simulateSubagents?: boolean;
  simulateSkills?: boolean;
  dryRun?: boolean;
  check?: boolean;
};

export type ImportOptions = BaseOptions & {
  target: ToolTarget;
  features?: Feature[];
};

export type ConvertOptions = BaseOptions & {
  from: ToolTarget;
  to: ToolTarget[];
  features?: Feature[];
  dryRun?: boolean;
};

export async function generate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const { silent = true, verbose = false, ...rest } = options;
  const logger = new ConsoleLogger({ verbose, silent });

  const config = await ConfigResolver.resolve({
    ...rest,
    verbose,
    silent,
  });

  for (const baseDir of config.getBaseDirs()) {
    if (!(await checkRulesyncDirExists({ baseDir }))) {
      throw new Error(`.rulesync directory not found in '${baseDir}'. Run 'rulesync init' first.`);
    }
  }

  return coreGenerate({ config, logger });
}

export async function importFromTool(options: ImportOptions): Promise<ImportResult> {
  const { target, features, silent = true, verbose = false, ...rest } = options;
  const logger = new ConsoleLogger({ verbose, silent });

  const config = await ConfigResolver.resolve({
    ...rest,
    targets: [target],
    features,
    verbose,
    silent,
  });

  return coreImportFromTool({ config, tool: target, logger });
}

export async function convertFromTool(options: ConvertOptions): Promise<ConvertResult> {
  const { from, to, features, silent = true, verbose = false, ...rest } = options;

  if (!to || to.length === 0) {
    throw new Error("to is required and must not be empty. Please specify destination tools.");
  }

  const logger = new ConsoleLogger({ verbose, silent });

  const config = await ConfigResolver.resolve({
    ...rest,
    targets: [from],
    features,
    verbose,
    silent,
  });

  return coreConvertFromTool({ config, fromTool: from, toTools: to, logger });
}
