import { ConfigResolver } from "./config/config-resolver.js";
import { convertFromTool as coreConvertFromTool, type ConvertResult } from "./lib/convert.js";
import {
  assertInputRootsResolvable,
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
  outputRoots?: string[];
  /**
   * Ordered list of rulesync source-tree directories (e.g. `.rulesync`,
   * `.rulesync.local`). Each entry is a source tree itself — the directory
   * that directly contains `rules/`, `skills/`, `mcp.jsonc`, etc. No
   * implicit `.rulesync/` join is applied. Defaults to
   * `[join(process.cwd(), ".rulesync")]`. Later entries override earlier
   * ones when the same relative source path appears in more than one root.
   * Mirrors the CLI's `--input-roots` option.
   *
   * Cannot be combined with `inputRoot`; use one or the other.
   */
  inputRoots?: string[];
  /**
   * @deprecated Use `inputRoots` instead. Kept as a backward-compatibility
   * alias: the value is the PARENT directory of the default `.rulesync/`
   * source tree, and internally expands to
   * `inputRoots: [join(inputRoot, ".rulesync")]`. Mirrors the CLI's
   * `--input-root` option. Cannot be combined with `inputRoots`.
   */
  inputRoot?: string;
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

  // The pre-flight check probes the input source roots rather than each
  // output root. This matches the CLI's behavior and the way features load
  // `.rulesync/**` content (always relative to `config.getInputRoots()`).
  // Every configured root must exist as a directory (typo protection), and
  // at least one of them must contain `.rulesync/` — an overlay-only root
  // is allowed to lack the directory when a base root already has it.
  const inputRoots = config.getInputRoots();

  await assertInputRootsResolvable(inputRoots);

  if (!(await checkRulesyncDirExists({ inputRoots }))) {
    throw new Error(
      `.rulesync directory not found in any of the configured input roots (${inputRoots
        .map((root) => `'${root}'`)
        .join(", ")}). Run 'rulesync init' first.`,
    );
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

  if (!from) {
    throw new Error("from is required. Please specify a source tool to convert from.");
  }

  if (!to || to.length === 0) {
    throw new Error("to is required and must not be empty. Please specify destination tools.");
  }

  const toTools = Array.from(new Set(to));

  if (toTools.includes(from)) {
    throw new Error(
      `Destination tools must not include the source tool '${from}'. ` +
        `Converting a tool onto itself is likely a mistake and may cause lossy round-trips.`,
    );
  }

  const logger = new ConsoleLogger({ verbose, silent });

  // NOTE: The CLI and MCP wrappers pass `[from, ...to]` as `targets` so that
  // per-target feature overrides in `rulesync.jsonc` apply to destinations too.
  // The JS API intentionally passes only `[from]` here because the public
  // contract for `convertFromTool` (issue #1557) prescribes this shape:
  // programmatic callers are expected to supply `features` explicitly when
  // they need fine-grained control, rather than relying on config-file
  // per-target maps. Defaulting `features` to `["*"]` below matches the CLI's
  // "attempt every feature both tools support" behavior so callers who omit
  // `features` get the same effective coverage as the CLI.
  const config = await ConfigResolver.resolve({
    ...rest,
    targets: [from],
    features: features ?? ["*"],
    verbose,
    silent,
  });

  return coreConvertFromTool({ config, fromTool: from, toTools, logger });
}
