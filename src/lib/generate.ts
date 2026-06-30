import { join } from "node:path";

import { intersection } from "es-toolkit";

import { Config } from "../config/config.js";
import { AGENTSMD_RULE_FILE_NAME } from "../constants/agentsmd-paths.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { AiDir } from "../types/ai-dir.js";
import { AiFile } from "../types/ai-file.js";
import { DirFeatureProcessor } from "../types/dir-feature-processor.js";
import { FeatureProcessor } from "../types/feature-processor.js";
import type { Feature } from "../types/features.js";
import type { RulesyncFile } from "../types/rulesync-file.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { fileExists, toPosixPath } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import type { FeatureGenerateResult } from "../utils/result.js";

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
  skills: RulesyncSkill[];
  hasDiff: boolean;
};

async function processFeatureGeneration<T extends AiFile>(params: {
  config: Config;
  processor: FeatureProcessor;
  toolFiles: T[];
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolFiles, skipFilePaths } = params;

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

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function processDirFeatureGeneration(params: {
  config: Config;
  processor: DirFeatureProcessor;
  toolDirs: AiDir[];
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolDirs } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiDirs(toolDirs);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolDirs = await processor.loadToolDirsToDelete();

    const orphanCount = await processor.removeOrphanAiDirs(existingToolDirs, toolDirs);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

// Handle special case for empty rulesync files
async function processEmptyFeatureGeneration(params: {
  config: Config;
  processor: FeatureProcessor;
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, skipFilePaths } = params;

  const totalCount = 0;
  let hasDiff = false;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

    const filesToDelete =
      skipFilePaths && skipFilePaths.size > 0
        ? existingToolFiles.filter((f) => !skipFilePaths.has(f.getRelativePathFromCwd()))
        : existingToolFiles;

    const orphanCount = await processor.removeOrphanAiFiles(filesToDelete, []);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: [], hasDiff };
}

/**
 * Dispatch to processEmptyFeatureGeneration or processFeatureGeneration
 * based on whether rulesync files exist.
 */
async function processFeatureWithRulesyncFiles(params: {
  config: Config;
  processor: FeatureProcessor;
  rulesyncFiles: RulesyncFile[];
  skipFilePaths?: Set<string>;
}): Promise<FeatureGenerateResult> {
  const { config, processor, rulesyncFiles, skipFilePaths } = params;
  if (rulesyncFiles.length === 0) {
    return processEmptyFeatureGeneration({ config, processor, skipFilePaths });
  }
  const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
  return processFeatureGeneration({ config, processor, toolFiles, skipFilePaths });
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
  for (const target of config.getTargets()) {
    if (!supportedTargets.includes(target) && config.getFeatures(target).includes(featureName)) {
      const simulateOption = SIMULATE_OPTION_MAP[featureName];
      if (simulateOption && simulatedTargets.includes(target)) {
        logger.warn(
          `Target '${target}' only supports simulated '${featureName}'. Use '${simulateOption}' to enable it. Skipping.`,
        );
      } else {
        logger.warn(`Target '${target}' does not support the feature '${featureName}'. Skipping.`);
      }
    }
  }
}

/**
 * Check if .rulesync directory exists.
 *
 * The `.rulesync/` directory lives under the *input* root (where source rules
 * are read from), not under any individual output root, so callers always pass
 * `config.getInputRoot()` here.
 */
export async function checkRulesyncDirExists(params: { inputRoot: string }): Promise<boolean> {
  return fileExists(join(params.inputRoot, RULESYNC_RELATIVE_DIR_PATH));
}

type GenerationStepId =
  | "ignore"
  | "mcp"
  | "commands"
  | "subagents"
  | "skills"
  | "hooks"
  | "permissions"
  | "rules";

type GenerationStep = {
  id: GenerationStepId;
  /** Tokens for on-disk files this step read-modify-writes and shares with other steps. */
  writesSharedFile?: string[];
  /** Step ids that must run before this one (they write a shared file this step then reads). */
  dependsOn?: GenerationStepId[];
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

/**
 * Generate configuration files for AI tools.
 * @throws Error if generation fails
 */
export async function generate(params: {
  config: Config;
  logger: Logger;
}): Promise<GenerateResult> {
  const { config, logger } = params;

  // Captured by the skills step so the rules step can read the generated skills.
  let skillsResult: Awaited<ReturnType<typeof generateSkillsCore>> | undefined;

  const steps: GenerationStep[] = [
    {
      id: "ignore",
      writesSharedFile: ["claude-settings", "zed-settings"],
      run: () => generateIgnoreCore({ config, logger }),
    },
    {
      id: "mcp",
      writesSharedFile: [
        "kilo-opencode-config",
        "zed-settings",
        "qwencode-settings",
        "augmentcode-settings",
        "hermesagent-config",
        "amp-settings",
        "codexcli-config",
        "grokcli-config",
        "vibe-config",
        "devin-config",
      ],
      dependsOn: ["ignore"],
      run: () => generateMcpCore({ config, logger }),
    },
    { id: "commands", run: () => generateCommandsCore({ config, logger }) },
    { id: "subagents", run: () => generateSubagentsCore({ config, logger }) },
    {
      id: "skills",
      run: async () => {
        skillsResult = await generateSkillsCore({ config, logger });
        return skillsResult;
      },
    },
    {
      id: "hooks",
      writesSharedFile: [
        "claude-settings",
        "qwencode-settings",
        "augmentcode-settings",
        "hermesagent-config",
        "kiro-agent-config",
        "codexcli-config",
        "vibe-config",
        "devin-config",
      ],
      dependsOn: ["ignore", "mcp"],
      run: () => generateHooksCore({ config, logger }),
    },
    {
      id: "permissions",
      writesSharedFile: [
        "claude-settings",
        "kilo-opencode-config",
        "zed-settings",
        "qwencode-settings",
        "augmentcode-settings",
        "hermesagent-config",
        "kiro-agent-config",
        "amp-settings",
        "codexcli-config",
        "grokcli-config",
        "vibe-config",
        "devin-config",
      ],
      dependsOn: ["ignore", "hooks", "mcp"],
      run: () => generatePermissionsCore({ config, logger }),
    },
    {
      id: "rules",
      writesSharedFile: ["kilo-opencode-config"],
      dependsOn: ["mcp", "skills", "permissions"],
      run: () => generateRulesCore({ config, logger, skills: skillsResult?.skills }),
    },
  ];

  const orderedSteps = resolveExecutionOrder(steps);

  const resultsById = new Map<GenerationStepId, FeatureGenerateResult>();
  for (const step of orderedSteps) {
    resultsById.set(step.id, await step.run());
  }

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

  const hasDiff = orderedSteps.some((step) => get(step.id).hasDiff);

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
    if (!params.global && factory.meta.mirrorsRootToAgentsMd) {
      register(".", AGENTSMD_RULE_FILE_NAME, target);
    }
  }
  return ownerByPath;
}

async function generateRulesCore(params: {
  config: Config;
  logger: Logger;
  skills?: RulesyncSkill[];
}): Promise<FeatureGenerateResult> {
  const { config, logger, skills } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if rules feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("rules")) {
        continue;
      }

      const processor = new RulesProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
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
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  const supportedIgnoreTargets = IgnoreProcessor.getToolTargets();
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedIgnoreTargets,
    featureName: "ignore",
    logger,
  });

  if (config.getGlobal()) {
    return { count: 0, paths: [], hasDiff: false };
  }

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  for (const toolTarget of intersection(config.getTargets(), supportedIgnoreTargets)) {
    // Check if ignore feature is enabled for this specific target
    if (!config.getFeatures(toolTarget).includes("ignore")) {
      continue;
    }

    for (const outputRoot of config.getOutputRoots()) {
      try {
        const processor = new IgnoreProcessor({
          // Pass `outputRoot` verbatim. The legacy
          // `outputRoot === process.cwd() ? "." : outputRoot` heuristic was a
          // leftover from before `outputRoots` was always resolved to absolute
          // paths in `ConfigResolver`; with that change it is now consistent
          // to pass the same `outputRoot` value the other processors receive.
          outputRoot,
          inputRoot: config.getInputRoot(),
          toolTarget,
          dryRun: config.isPreviewMode(),
          logger,
          featureOptions: config.getFeatureOptions(toolTarget, "ignore"),
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} ignore files for ${outputRoot}: ${formatError(error)}`,
        );
        continue;
      }
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateMcpCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if mcp feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("mcp")) {
        continue;
      }

      const processor = new McpProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

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
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if commands feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("commands")) {
        continue;
      }

      const processor = new CommandsProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
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
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if subagents feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("subagents")) {
        continue;
      }

      const processor = new SubagentsProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

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
}): Promise<FeatureGenerateResult & { skills: RulesyncSkill[] }> {
  const { config, logger } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if skills feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("skills")) {
        continue;
      }

      const processor = new SkillsProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
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
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if hooks feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("hooks")) {
        continue;
      }

      const processor = new HooksProcessor({
        outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

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
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

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

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of intersection(config.getTargets(), supportedPermissionsTargets)) {
      if (!config.getFeatures(toolTarget).includes("permissions")) {
        continue;
      }

      try {
        const processor = new PermissionsProcessor({
          outputRoot,
          inputRoot: config.getInputRoot(),
          toolTarget,
          global: config.getGlobal(),
          dryRun: config.isPreviewMode(),
          logger,
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} permissions files for ${outputRoot}: ${formatError(error)}`,
        );
        continue;
      }
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}
