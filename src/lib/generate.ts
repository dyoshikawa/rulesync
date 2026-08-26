import { basename, extname, join } from "node:path";

import { intersection } from "es-toolkit";

import { Config } from "../config/config.js";
import { AGENTSMD_RULE_FILE_NAME } from "../constants/agentsmd-paths.js";
import {
  HERMESAGENT_CHECKS_PLUGIN_MANIFEST_PATH,
  HERMESAGENT_IGNORE_PLUGIN_MANIFEST_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH,
} from "../constants/hermesagent-paths.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import {
  activateHermesProjectPlugins,
  type HermesProjectPluginName,
} from "../features/shared/hermes-project-plugin-activation.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { RulesyncSubagent } from "../features/subagents/rulesync-subagent.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { AiDir } from "../types/ai-dir.js";
import { AiFile } from "../types/ai-file.js";
import { DirFeatureProcessor } from "../types/dir-feature-processor.js";
import { FeatureProcessor, resetRootShadowingWarnings } from "../types/feature-processor.js";
import type { Feature } from "../types/features.js";
import { getProcessorRegistryEntry } from "../types/processor-registry.js";
import type { RulesyncFile } from "../types/rulesync-file.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { stripControlCharacters } from "../utils/control-characters.js";
import { formatError } from "../utils/error.js";
import { directoryExists, fileExists, toPosixPath } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import { assertPluginRootSafe } from "../utils/plugin-root.js";
import type { FeatureGenerateResult } from "../utils/result.js";
import { resolveToolOutputRoot } from "../utils/tool-output-root.js";
import { resetWarnedOnceMessages } from "../utils/warned-once.js";
import { createOrphanSweepPlan, type OrphanSweepPlan } from "./orphan-sweep.js";
import { deriveSharedWriteSteps } from "./shared-file-derive.js";

export type GenerateResult = {
  rulesCount: number;
  rulesPaths: string[];
  ignoreCount: number;
  ignorePaths: string[];
  mcpCount: number;
  mcpPaths: string[];
  commandsCount: number;
  commandsPaths: string[];
  subagentsCount: number;
  subagentsPaths: string[];
  skillsCount: number;
  skillsPaths: string[];
  hooksCount: number;
  hooksPaths: string[];
  permissionsCount: number;
  permissionsPaths: string[];
  checksCount: number;
  checksPaths: string[];
  activationCount: number;
  activationPaths: string[];
  skills: RulesyncSkill[];
  hasDiff: boolean;
};

async function processFeatureGeneration<T extends AiFile>(params: {
  config: Config;
  processor: FeatureProcessor;
  toolFiles: T[];
  sweepPlan: OrphanSweepPlan;
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolFiles, sweepPlan, skipFilePaths } = params;

  const filesToCheck =
    skipFilePaths && skipFilePaths.size > 0
      ? toolFiles.filter((f) => !skipFilePaths.has(f.getRelativePathFromCwd()))
      : toolFiles;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiFiles(filesToCheck);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  // Registered even when the write was a no-op (unchanged content), a dry run, or
  // skipped for root-file ownership: what protects a path from a sibling target's
  // sweep is that this run owns it, not that these particular bytes were flushed.
  // `toolFiles` rather than `filesToCheck` for exactly that reason.
  sweepPlan.registerGenerated({ paths: toolFiles.map((f) => f.getFilePath()) });

  if (config.getDelete()) {
    sweepPlan.defer({
      sweep: async () => {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });
        // Claimed paths are dropped before the processor sees them. A processor
        // that reads `existingFiles` for something other than the orphan
        // comparison (`CommandsProcessor` checks it for the hermesagent
        // ownership marker) therefore sees the unclaimed remainder — which is
        // equivalent today, because a path this run claims is a path that
        // processor also lists in `generatedFiles`.
        const orphanCount = await processor.removeOrphanAiFiles(
          sweepPlan.rejectClaimed({
            items: existingToolFiles,
            getPath: (f) => f.getFilePath(),
          }),
          toolFiles,
        );
        return orphanCount > 0;
      },
    });
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function processDirFeatureGeneration(params: {
  config: Config;
  processor: DirFeatureProcessor;
  toolDirs: AiDir[];
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolDirs, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiDirs(toolDirs);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  // As whole trees: a directory feature owns everything it writes underneath the
  // directory, and a *file* feature's sweep can now enumerate that directory
  // (deferring the sweeps means every sweep runs after the skills step has
  // written), so claiming the directory path alone would leave `SKILL.md` and
  // its companions looking like orphans.
  //
  // Only a directory that is actually named after itself owns a whole tree.
  // `TaktSkill` overrides `getDirPath()` to drop `dirName` and return the shared
  // root every takt skill flattens into; claiming *that* as a tree would exempt
  // every sibling under the root from the sweep. Such a directory gets an exact
  // claim instead, which still protects the path this run wrote.
  const ownedTrees = toolDirs.filter((d) => d.ownsDirTree());
  sweepPlan.registerGeneratedTree({ paths: ownedTrees.map((d) => d.getDirPath()) });
  sweepPlan.registerGenerated({ paths: toolDirs.map((d) => d.getDirPath()) });

  if (config.getDelete()) {
    sweepPlan.defer({
      sweep: async () => {
        const existingToolDirs = await processor.loadToolDirsToDelete();
        const orphanCount = await processor.removeOrphanAiDirs(
          sweepPlan.rejectClaimed({
            items: existingToolDirs,
            getPath: (d) => d.getDirPath(),
          }),
          toolDirs,
        );
        return orphanCount > 0;
      },
    });
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

// Handle special case for empty rulesync files
async function processEmptyFeatureGeneration(params: {
  config: Config;
  processor: FeatureProcessor;
  sweepPlan: OrphanSweepPlan;
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, sweepPlan, skipFilePaths } = params;

  const totalCount = 0;

  if (config.getDelete()) {
    sweepPlan.defer({
      sweep: async () => {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

        const filesToDelete = sweepPlan
          .rejectClaimed({ items: existingToolFiles, getPath: (f) => f.getFilePath() })
          .filter((f) => !skipFilePaths?.has(f.getRelativePathFromCwd()));

        const orphanCount = await processor.removeOrphanAiFiles(filesToDelete, []);
        return orphanCount > 0;
      },
    });
  }

  return { count: totalCount, paths: [], hasDiff: false };
}

/**
 * Dispatch to processEmptyFeatureGeneration or processFeatureGeneration
 * based on whether rulesync files exist.
 */
async function processFeatureWithRulesyncFiles(params: {
  config: Config;
  processor: FeatureProcessor;
  rulesyncFiles: RulesyncFile[];
  sweepPlan: OrphanSweepPlan;
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, rulesyncFiles, sweepPlan, skipFilePaths } = params;
  if (rulesyncFiles.length === 0) {
    return processEmptyFeatureGeneration({ config, processor, sweepPlan, skipFilePaths });
  }
  const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
  return processFeatureGeneration({ config, processor, toolFiles, sweepPlan, skipFilePaths });
}

const SIMULATE_OPTION_MAP: Partial<Record<Feature, string>> = {
  commands: "--simulate-commands",
  subagents: "--simulate-subagents",
  skills: "--simulate-skills",
};

function warnUnsupportedTargets(params: {
  config: Config;
  supportedTargets: ToolTarget[];
  simulatedTargets?: ToolTarget[];
  featureName: Feature;
  logger: Logger;
}): void {
  const { config, supportedTargets, simulatedTargets = [], featureName, logger } = params;
  let oppositeScopeTargets: ToolTarget[] = [];
  try {
    oppositeScopeTargets = getProcessorRegistryEntry(featureName).processor.getToolTargets({
      global: !config.getGlobal(),
    });
  } catch {
    oppositeScopeTargets = [];
  }
  for (const target of config.getTargets()) {
    if (!supportedTargets.includes(target) && config.getFeatures(target).includes(featureName)) {
      const simulateOption = SIMULATE_OPTION_MAP[featureName];
      if (simulateOption && simulatedTargets.includes(target)) {
        logger.warn(
          `Target '${target}' only supports simulated '${featureName}'. Use '${simulateOption}' to enable it. Skipping.`,
        );
      } else if (oppositeScopeTargets.includes(target)) {
        const supportedScope = config.getGlobal() ? "project" : "global";
        const retry = config.getGlobal() ? "without '--global'" : "with '--global'";
        logger.warn(
          `Target '${target}' supports the feature '${featureName}' only in ${supportedScope} scope. Re-run ${retry}. Skipping.`,
        );
      } else {
        logger.warn(`Target '${target}' does not support the feature '${featureName}'. Skipping.`);
      }
    }
  }
}

/**
 * Inspect every configured input-root path. The first entry is the required
 * base source tree; later entries are optional overlays and may be absent.
 * Each existing entry is a rulesync source tree itself (the directory that
 * directly holds `rules/`, `skills/`, `mcp.jsonc`, etc.). Existing empty
 * directories are valid because delete and check workflows still need to
 * inspect generated outputs.
 */
export async function inspectInputRoots(inputRoots: readonly string[]): Promise<{
  existing: string[];
  missing: string[];
  message: string | undefined;
}> {
  const existing: string[] = [];
  const missing: string[] = [];
  const invalidOverlays: string[] = [];
  const nonDirectories = new Set<string>();

  for (const [index, root] of inputRoots.entries()) {
    if (await directoryExists(root)) {
      existing.push(root);
    } else {
      missing.push(root);

      // A path that exists but is not a directory is a different mistake than
      // a path that is simply absent, so it gets its own wording below.
      if (await fileExists(root)) {
        nonDirectories.add(root);

        if (index > 0) {
          invalidOverlays.push(root);
        }
      }
    }
  }

  const primaryRoot = inputRoots[0];
  // Input roots come from a config file that can be checked into a repository,
  // so every one of them is sanitized before it reaches the terminal. These
  // messages are the easiest of the lot to reach: a root only has to be
  // configured, not to exist.
  const displayPrimaryRoot = stripControlCharacters(primaryRoot ?? "");

  if (primaryRoot === undefined || existing.includes(primaryRoot)) {
    const invalidOverlay = invalidOverlays[0];

    return {
      existing,
      missing,
      message:
        invalidOverlay === undefined
          ? undefined
          : `Configured optional input root '${stripControlCharacters(invalidOverlay)}' exists but is not a directory.`,
    };
  }

  const defaultRoot = join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH);

  if (primaryRoot === defaultRoot && !nonDirectories.has(primaryRoot)) {
    return {
      existing,
      missing,
      message: `Rulesync source directory '${defaultRoot}' does not exist. Run 'rulesync init' first.`,
    };
  }

  // The primary root can come from either the plural `inputRoots` or the
  // deprecated singular `inputRoot`, and this function does not know which one
  // the user actually wrote, so the hint names both instead of asserting a
  // setting the user may not have.
  const settingHint = `your input root setting ('inputRoots', or the deprecated 'inputRoot')`;

  if (nonDirectories.has(primaryRoot)) {
    return {
      existing,
      missing,
      message: `Configured primary input root '${displayPrimaryRoot}' exists but is not a directory. Point ${settingHint} at a directory.`,
    };
  }

  return {
    existing,
    missing,
    message: `Configured primary input root '${displayPrimaryRoot}' does not exist. Create the directory or update ${settingHint}.`,
  };
}

type GenerationStepId =
  | "ignore"
  | "mcp"
  | "commands"
  | "subagents"
  | "skills"
  | "hooks"
  | "permissions"
  | "checks"
  | "rules";

type GenerationStep = {
  id: GenerationStepId;
  /** `dir/file` keys for on-disk files this step read-modify-writes and shares with other steps. */
  writesSharedFile?: readonly string[];
  /** Step ids that must run before this one (they write a shared file this step then reads). */
  dependsOn?: readonly GenerationStepId[];
  run: () => Promise<FeatureGenerateResult>;
};

function dependsOnReachable(
  byId: Map<GenerationStepId, GenerationStep>,
  from: GenerationStepId,
  target: GenerationStepId,
): boolean {
  const seen = new Set<GenerationStepId>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (current === target) return true;
    for (const dep of byId.get(current)?.dependsOn ?? []) {
      stack.push(dep);
    }
  }
  return false;
}

function assertSharedFilesOrdered(
  steps: GenerationStep[],
  byId: Map<GenerationStepId, GenerationStep>,
): void {
  const writersByFile = new Map<string, GenerationStepId[]>();
  for (const step of steps) {
    for (const file of step.writesSharedFile ?? []) {
      writersByFile.set(file, [...(writersByFile.get(file) ?? []), step.id]);
    }
  }
  for (const [file, writers] of writersByFile) {
    for (let i = 0; i < writers.length; i++) {
      for (let j = i + 1; j < writers.length; j++) {
        const a = writers[i]!;
        const b = writers[j]!;
        if (!dependsOnReachable(byId, a, b) && !dependsOnReachable(byId, b, a)) {
          throw new Error(
            `Generation steps '${a}' and '${b}' both write the shared file '${file}' ` +
              `but neither declares a 'dependsOn' the other. Add a 'dependsOn' so the ` +
              `read-modify-write order is fixed; otherwise one step silently drops the ` +
              `other's keys.`,
          );
        }
      }
    }
  }
}

/**
 * Topologically sort generation steps and reject ordering hazards: a shared file
 * with two writers not ordered by `dependsOn` (a silent data-loss trap), an
 * unknown dependency, or a cycle. Reordering `steps` stays safe as a result.
 *
 * @throws Error if a shared file has unordered writers, a dependency is unknown,
 *   or the dependency graph contains a cycle.
 */
export function resolveExecutionOrder(steps: GenerationStep[]): GenerationStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));

  assertSharedFilesOrdered(steps, byId);

  const unresolvedDeps = new Map<GenerationStepId, number>(steps.map((step) => [step.id, 0]));
  const dependents = new Map<GenerationStepId, GenerationStepId[]>();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`Generation step '${step.id}' depends on unknown step '${dep}'.`);
      }
      unresolvedDeps.set(step.id, (unresolvedDeps.get(step.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), step.id]);
    }
  }

  const ready = steps
    .filter((step) => (unresolvedDeps.get(step.id) ?? 0) === 0)
    .map((step) => step.id);
  const ordered: GenerationStep[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (unresolvedDeps.get(dependent) ?? 0) - 1;
      unresolvedDeps.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
  }

  if (ordered.length !== steps.length) {
    throw new Error("Generation steps contain a cyclic 'dependsOn' dependency.");
  }

  return ordered;
}

type GenerationStepMeta = Readonly<Omit<GenerationStep, "run">>;

const SHARED_WRITE_STEPS = deriveSharedWriteSteps();

const sharedWriteMeta = (
  id: GenerationStepId,
): Pick<GenerationStepMeta, "writesSharedFile" | "dependsOn"> => {
  const step = SHARED_WRITE_STEPS.get(id);
  return step ? { writesSharedFile: step.writesSharedFile, dependsOn: step.dependsOn } : {};
};

/**
 * The static shape of the generation step graph: which steps write which shared
 * (read-modify-write) config files, and the `dependsOn` edges that fix a safe order
 * for those writers. Both are derived from the processor registry's settable
 * paths and `SHARED_WRITE_FEATURE_ORDER` (see `shared-file-derive.ts`), so a new
 * tool or shared path never requires editing this graph. Exported (separately
 * from the `run` closures, which need a live `config`/`logger`) so
 * `resolveExecutionOrder`'s ordering guarantee can be tested directly against
 * the real graph rather than a hand-copied one. Readonly so a consumer can't
 * mutate this module-level singleton and affect every subsequent `generate()`
 * call in the process.
 */
export const GENERATION_STEP_GRAPH: readonly GenerationStepMeta[] = [
  { id: "ignore", ...sharedWriteMeta("ignore") },
  { id: "mcp", ...sharedWriteMeta("mcp") },
  { id: "commands", ...sharedWriteMeta("commands") },
  { id: "subagents", ...sharedWriteMeta("subagents") },
  { id: "skills" },
  { id: "hooks", ...sharedWriteMeta("hooks") },
  // Checks reach a shared file only for Takt (`workflow_overrides` in
  // `.takt/config.yaml`), so this step carries shared-write metadata like the
  // rest and must run before the features that write the same file.
  { id: "checks", ...sharedWriteMeta("checks") },
  { id: "permissions", ...sharedWriteMeta("permissions") },
  {
    id: "rules",
    ...sharedWriteMeta("rules"),
    // On top of the derived shared-file edges, rules reads the skills list the
    // skills step produces (a value dependency, not a shared-file one).
    dependsOn: [...(sharedWriteMeta("rules").dependsOn ?? []), "skills"],
  },
];

/**
 * Warn when a rulesync skill and a rulesync subagent share a name for a tool
 * that emits both features into the same directory (e.g. Reasonix, where both
 * write `<name>/SKILL.md` under `.reasonix/skills/`). The colliding outputs
 * target the same on-disk file, so whichever generation step runs later
 * silently overwrites the other's file.
 */
async function warnSkillSubagentNameCollisions(params: {
  config: Config;
  logger: Logger;
}): Promise<void> {
  const { config, logger } = params;
  const global = config.getGlobal();

  for (const toolTarget of config.getTargets()) {
    const features = config.getFeatures(toolTarget);
    if (!features.includes("skills") || !features.includes("subagents")) {
      continue;
    }
    // Mirror the generation steps' target filtering: getSettablePaths may
    // throw for a scope the tool does not support (e.g. agentsmd skills in
    // global mode), so only consult tools both features actually run for.
    if (
      !SubagentsProcessor.getToolTargets({ global }).includes(toolTarget) ||
      !SkillsProcessor.getToolTargets({ global }).includes(toolTarget)
    ) {
      continue;
    }
    const subagentFactory = SubagentsProcessor.getFactory(toolTarget);
    const skillFactory = SkillsProcessor.getFactory(toolTarget);
    if (!subagentFactory || !skillFactory) {
      continue;
    }
    const subagentsDirPath = subagentFactory.class.getSettablePaths({ global }).relativeDirPath;
    const skillsDirPath = skillFactory.class.getSettablePaths({ global }).relativeDirPath;
    if (subagentsDirPath !== skillsDirPath) {
      continue;
    }

    const subagentsProcessor = new SubagentsProcessor({
      inputRoots: config.getInputRoots(),
      toolTarget,
      global,
      logger,
    });
    const subagentNames = new Set(
      (await subagentsProcessor.loadRulesyncFiles())
        .filter((file): file is RulesyncSubagent => file instanceof RulesyncSubagent)
        .filter((file) => subagentFactory.class.isTargetedByRulesyncSubagent(file))
        .map((file) => basename(file.getRelativeFilePath(), extname(file.getRelativeFilePath()))),
    );
    if (subagentNames.size === 0) {
      continue;
    }

    const skillsProcessor = new SkillsProcessor({
      inputRoots: config.getInputRoots(),
      toolTarget,
      global,
      logger,
    });
    const skillNames = (await skillsProcessor.loadRulesyncDirs())
      .filter((dir): dir is RulesyncSkill => dir instanceof RulesyncSkill)
      .filter((skill) => skillFactory.class.isTargetedByRulesyncSkill(skill))
      .map((skill) => skill.getDirName());

    for (const name of skillNames) {
      if (subagentNames.has(name)) {
        logger.warn(
          `Skill "${name}" and subagent "${name}" both target '${toolTarget}' and write the ` +
            `same path '${join(subagentsDirPath, name)}'; the later generation step ` +
            `overwrites the other's output. Rename one of them or narrow their targets.`,
        );
      }
    }
  }
}

async function collectHermesProjectPluginNames({
  config,
  resultsById,
}: {
  config: Config;
  resultsById: ReadonlyMap<GenerationStepId, FeatureGenerateResult>;
}): Promise<HermesProjectPluginName[]> {
  if (config.getGlobal() || !config.getTargets().includes("hermesagent")) {
    return [];
  }

  const outputRoots = config.getOutputRoots("hermesagent");
  const enabledFeatures = config.getFeatures("hermesagent");
  const descriptors: ReadonlyArray<{
    feature: "ignore" | "subagents" | "checks";
    pluginName: HermesProjectPluginName;
    manifestPath: string;
  }> = [
    {
      feature: "ignore",
      pluginName: "rulesync-ignore",
      manifestPath: HERMESAGENT_IGNORE_PLUGIN_MANIFEST_PATH,
    },
    {
      feature: "subagents",
      pluginName: "rulesync-subagents",
      manifestPath: HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH,
    },
    {
      feature: "checks",
      pluginName: "rulesync-checks",
      manifestPath: HERMESAGENT_CHECKS_PLUGIN_MANIFEST_PATH,
    },
  ];
  const pluginNames: HermesProjectPluginName[] = [];

  for (const descriptor of descriptors) {
    if (!enabledFeatures.includes(descriptor.feature)) {
      continue;
    }
    const relativeManifestPath = toPosixPath(descriptor.manifestPath);
    const generationResult = resultsById.get(descriptor.feature);
    const willWriteManifest =
      generationResult?.paths.some(
        (generatedPath) => toPosixPath(generatedPath) === relativeManifestPath,
      ) ?? false;
    let manifestExists = false;
    for (const outputRoot of outputRoots) {
      if (await fileExists(join(outputRoot, descriptor.manifestPath))) {
        manifestExists = true;
        break;
      }
    }
    if (willWriteManifest || manifestExists) {
      pluginNames.push(descriptor.pluginName);
    }
  }

  return pluginNames;
}

/**
 * Generate configuration files for AI tools.
 * @throws Error if generation fails
 */
export async function generate(params: {
  config: Config;
  logger: Logger;
}): Promise<GenerateResult> {
  const { config, logger } = params;

  // Single-file features suppress a repeated shadowing warning per logger, and
  // `--watch` reuses one logger across every regeneration, so each run starts
  // from a clean slate.
  resetRootShadowingWarnings({ logger });
  // "Once per run" means once per generate, not once per process: `--watch` and
  // the MCP server keep one process alive across many runs, and a warning that
  // still applies has to be said again.
  resetWarnedOnceMessages();

  for (const toolTarget of config.getTargets()) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      await assertPluginRootSafe({ toolTarget, outputRoot });
    }
  }

  await warnSkillSubagentNameCollisions({ config, logger });

  // Captured by the skills step so the rules step can read the generated skills.
  let skillsResult: Awaited<ReturnType<typeof generateSkillsCore>> | undefined;

  // One plan for the whole run: every step registers what it writes into it, and
  // every `--delete` sweep is held back until the last step has written, so no
  // target sweeps a directory it shares with a target that has not run yet.
  const sweepPlan = createOrphanSweepPlan();

  const runners: Record<GenerationStepId, () => Promise<FeatureGenerateResult>> = {
    ignore: () => generateIgnoreCore({ config, logger, sweepPlan }),
    mcp: () => generateMcpCore({ config, logger, sweepPlan }),
    commands: () => generateCommandsCore({ config, logger, sweepPlan }),
    subagents: () => generateSubagentsCore({ config, logger, sweepPlan }),
    skills: async () => {
      skillsResult = await generateSkillsCore({ config, logger, sweepPlan });
      return skillsResult;
    },
    hooks: () => generateHooksCore({ config, logger, sweepPlan }),
    permissions: () => generatePermissionsCore({ config, logger, sweepPlan }),
    checks: () => generateChecksCore({ config, logger, sweepPlan }),
    rules: () => generateRulesCore({ config, logger, sweepPlan, skills: skillsResult?.skills }),
  };

  const steps: GenerationStep[] = GENERATION_STEP_GRAPH.map((meta) => ({
    ...meta,
    run: runners[meta.id],
  }));

  const orderedSteps = resolveExecutionOrder(steps);

  const resultsById = new Map<GenerationStepId, FeatureGenerateResult>();
  for (const step of orderedSteps) {
    resultsById.set(step.id, await step.run());
  }

  // Deletion runs only now, once every step has written: a sweep that ran inline
  // would remove files a later step is about to write, which is both destructive
  // for shared output directories and a permanent `--check` diff. A step that
  // throws therefore skips every sweep rather than leaving a half-swept tree,
  // which is the safer of the two failure modes for a destructive operation.
  const sweepHasDiff = await sweepPlan.run();

  const activationResult = await activateHermesProjectPlugins({
    pluginNames: await collectHermesProjectPluginNames({ config, resultsById }),
    dryRun: config.isPreviewMode(),
    logger,
  });

  if (!skillsResult) {
    throw new Error("Skills generation step did not run.");
  }

  const get = (id: GenerationStepId): FeatureGenerateResult => {
    const result = resultsById.get(id);
    if (!result) {
      throw new Error(`Missing generation result for step '${id}'.`);
    }
    return result;
  };

  const hasDiff =
    sweepHasDiff || activationResult.hasDiff || orderedSteps.some((step) => get(step.id).hasDiff);

  return {
    rulesCount: get("rules").count,
    rulesPaths: get("rules").paths,
    ignoreCount: get("ignore").count,
    ignorePaths: get("ignore").paths,
    mcpCount: get("mcp").count,
    mcpPaths: get("mcp").paths,
    commandsCount: get("commands").count,
    commandsPaths: get("commands").paths,
    subagentsCount: get("subagents").count,
    subagentsPaths: get("subagents").paths,
    skillsCount: skillsResult.count,
    skillsPaths: skillsResult.paths,
    hooksCount: get("hooks").count,
    hooksPaths: get("hooks").paths,
    permissionsCount: get("permissions").count,
    permissionsPaths: get("permissions").paths,
    checksCount: get("checks").count,
    checksPaths: get("checks").paths,
    activationCount: activationResult.count,
    activationPaths: activationResult.paths,
    skills: skillsResult.skills,
    hasDiff,
  };
}

// Maps every root-rule file path a target actually emits to that target, so
// `generate --check` can skip root files a (CLI-selected) target does not own.
//
// Ownership is "last target in config order wins": the loop iterates the config
// file's full target list and `Map.set` overwrites, so the final writer in
// config order owns a shared path — consistent with generation write order,
// where the last target's content is what ends up on disk.
//
// Note: a single ownership decision is applied uniformly across all output
// roots (paths are output-root-relative). Multi-output-root `--check` would
// need per-output-root keying; that is out of scope here.
function computeRootFileOwnership(params: {
  targets: ToolTarget[];
  global: boolean;
}): Map<string, ToolTarget> {
  const ownerByPath = new Map<string, ToolTarget>();
  const register = (
    relativeDirPath: string,
    relativeFilePath: string,
    target: ToolTarget,
  ): void => {
    ownerByPath.set(toPosixPath(join(relativeDirPath, relativeFilePath)), target);
  };
  for (const target of params.targets) {
    const factory = RulesProcessor.getFactory(target);
    if (!factory) continue;
    const paths = factory.class.getSettablePaths({ global: params.global });
    if ("root" in paths && paths.root) {
      register(paths.root.relativeDirPath, paths.root.relativeFilePath, target);
    }
    // Secondary/fallback root locations a target recognizes are attributed to
    // it as well, so a shared collision at one of those paths is skipped for
    // non-owning targets.
    if ("alternativeRoots" in paths && paths.alternativeRoots) {
      for (const alt of paths.alternativeRoots) {
        register(alt.relativeDirPath, alt.relativeFilePath, target);
      }
    }
    // Some targets (e.g. rovodev) mirror their primary root — which lives in a
    // subdirectory — to a project-root `./AGENTS.md` at generation time (project
    // scope only). That mirror is exactly the shared-collision path, so it must
    // be attributed to the target too, otherwise ownership/skip decisions invert.
    // (For rovodev this overlaps its `alternativeRoots` today; the explicit
    // block keeps ownership correct even if that alt root is ever removed.)
    if (!params.global && factory.class.getRootMirror) {
      register(".", AGENTSMD_RULE_FILE_NAME, target);
    }
  }
  return ownerByPath;
}

async function generateRulesCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
  skills?: RulesyncSkill[];
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan, skills } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedTargets = RulesProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedTargets);
  warnUnsupportedTargets({ config, supportedTargets, featureName: "rules", logger });

  const isCheck = config.getCheck();
  const rootFileOwner = isCheck
    ? computeRootFileOwnership({
        targets: config.getConfigFileTargets(),
        global: config.getGlobal(),
      })
    : new Map<string, ToolTarget>();

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if rules feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("rules")) {
        continue;
      }

      const processor = new RulesProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
        skills: skills,
        featureOptions: config.getFeatureOptions(toolTarget, "rules"),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();

      const skipFilePaths = new Set<string>();
      if (isCheck) {
        for (const [rootPath, owner] of rootFileOwner) {
          if (owner !== toolTarget) {
            skipFilePaths.add(rootPath);
          }
        }
      }

      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        sweepPlan,
        skipFilePaths: skipFilePaths.size > 0 ? skipFilePaths : undefined,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateIgnoreCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  const global = config.getGlobal();
  const supportedIgnoreTargets = IgnoreProcessor.getToolTargets({ global });
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedIgnoreTargets,
    featureName: "ignore",
    logger,
  });

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  for (const toolTarget of intersection(config.getTargets(), supportedIgnoreTargets)) {
    // Check if ignore feature is enabled for this specific target
    if (!config.getFeatures(toolTarget).includes("ignore")) {
      continue;
    }

    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      try {
        const processor = new IgnoreProcessor({
          // Pass `outputRoot` verbatim. The legacy
          // `outputRoot === process.cwd() ? "." : outputRoot` heuristic was a
          // leftover from before `outputRoots` was always resolved to absolute
          // paths in `ConfigResolver`; with that change it is now consistent
          // to pass the same `outputRoot` value the other processors receive.
          // No `resolveToolOutputRoot` either: the tools with a home override
          // (hermesagent, kimi-code) are not global ignore targets, so there is
          // nothing to redirect. Route through it if that ever changes.
          outputRoot,
          inputRoots: config.getInputRoots(),
          toolTarget,
          global,
          dryRun: config.isPreviewMode(),
          logger,
          featureOptions: config.getFeatureOptions(toolTarget, "ignore"),
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        const result = await processFeatureWithRulesyncFiles({
          config,
          processor,
          rulesyncFiles,
          sweepPlan,
        });

        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        // Ignore files are what keep secrets out of AI tools' reach — a
        // silently-skipped ignore generation is the same fail-open bug the
        // permissions feature had (#2486), so it fails the run the same way.
        logger.error(
          `Failed to generate ${toolTarget} ignore files for ${outputRoot}: ${formatError(error)}`,
        );
        throw error;
      }
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateMcpCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedMcpTargets = McpProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedMcpTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedMcpTargets,
    featureName: "mcp",
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if mcp feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("mcp")) {
        continue;
      }

      const processor = new McpProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        sweepPlan,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateCommandsCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedCommandsTargets = CommandsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateCommands(),
  });
  const toolTargets = intersection(config.getTargets(), supportedCommandsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedCommandsTargets,
    simulatedTargets: CommandsProcessor.getToolTargetsSimulated(),
    featureName: "commands",
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if commands feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("commands")) {
        continue;
      }

      const processor = new CommandsProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        flattenedCommandNaming: config.getFlattenedCommandNaming(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();

      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        sweepPlan,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateSubagentsCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedSubagentsTargets = SubagentsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateSubagents(),
  });
  const toolTargets = intersection(config.getTargets(), supportedSubagentsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedSubagentsTargets,
    simulatedTargets: SubagentsProcessor.getToolTargetsSimulated(),
    featureName: "subagents",
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if subagents feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("subagents")) {
        continue;
      }

      const processor = new SubagentsProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        sweepPlan,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateSkillsCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult & { skills: RulesyncSkill[] }> {
  const { config, logger, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;
  const allSkills: RulesyncSkill[] = [];

  const supportedSkillsTargets = SkillsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateSkills(),
  });
  const toolTargets = intersection(config.getTargets(), supportedSkillsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedSkillsTargets,
    simulatedTargets: SkillsProcessor.getToolTargetsSimulated(),
    featureName: "skills",
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if skills feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("skills")) {
        continue;
      }

      const processor = new SkillsProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncDirs = await processor.loadRulesyncDirs();

      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);

      const result = await processDirFeatureGeneration({
        config,
        processor,
        toolDirs,
        sweepPlan,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, skills: allSkills, hasDiff };
}

async function generateHooksCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedHooksTargets = HooksProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedHooksTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedHooksTargets,
    featureName: "hooks",
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if hooks feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("hooks")) {
        continue;
      }

      const processor = new HooksProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        sweepPlan,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generatePermissionsCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  const supportedPermissionsTargets = PermissionsProcessor.getToolTargets({
    global: config.getGlobal(),
  });
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedPermissionsTargets,
    featureName: "permissions",
    logger,
  });

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  for (const toolTarget of intersection(config.getTargets(), supportedPermissionsTargets)) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      if (!config.getFeatures(toolTarget).includes("permissions")) {
        continue;
      }

      try {
        const processor = new PermissionsProcessor({
          outputRoot: resolveToolOutputRoot({
            outputRoot,
            toolTarget,
            global: config.getGlobal(),
          }),
          inputRoots: config.getInputRoots(),
          toolTarget,
          global: config.getGlobal(),
          dryRun: config.isPreviewMode(),
          logger,
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        const result = await processFeatureWithRulesyncFiles({
          config,
          processor,
          rulesyncFiles,
          sweepPlan,
        });

        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        // A malformed shared config (e.g. .vibe/config.toml) must fail the run
        // the same way the MCP feature does — swallowing it reported
        // "All files are up to date" while the user's permission changes were
        // silently not applied.
        logger.error(
          `Failed to generate ${toolTarget} permissions files for ${outputRoot}: ${formatError(error)}`,
        );
        throw error;
      }
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateChecksCore(params: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
}): Promise<FeatureGenerateResult> {
  const { config, logger, sweepPlan } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedChecksTargets = ChecksProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedChecksTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedChecksTargets,
    featureName: "checks",
    logger,
  });

  for (const toolTarget of toolTargets) {
    for (const outputRoot of config.getOutputRoots(toolTarget)) {
      // Check if checks feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("checks")) {
        continue;
      }

      const processor = new ChecksProcessor({
        outputRoot: resolveToolOutputRoot({
          outputRoot,
          toolTarget,
          global: config.getGlobal(),
        }),
        inputRoots: config.getInputRoots(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
        sweepPlan,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}
