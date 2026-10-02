import { resolve } from "node:path";

import type { Config } from "../config/config.js";
import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor, toolRuleFactories } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import type { DirFeatureProcessor } from "../types/dir-feature-processor.js";
import type { FeatureProcessor } from "../types/feature-processor.js";
import type { Feature } from "../types/features.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { fileExists } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import type { OrphanSweepPlan } from "./orphan-sweep.js";

type ProcessorParams = {
  outputRoot: string;
  inputRoots: readonly [string, ...string[]];
  toolTarget: ToolTarget;
  global: false;
  dryRun: boolean;
  logger: Logger;
};

type RetirementSpec =
  | {
      kind: "file";
      supportedTargets: (config: Config) => ToolTarget[];
      create: (params: ProcessorParams, config: Config) => FeatureProcessor;
      /** Paths the deletion listing may contain that Rulesync never writes. */
      unownedPaths?: (params: ProcessorParams) => string[];
    }
  | {
      kind: "dir";
      supportedTargets: (config: Config) => ToolTarget[];
      create: (params: ProcessorParams, config: Config) => DirFeatureProcessor;
    };

// Each processor only has to locate the target's managed outputs, so it gets
// the arguments that decide *where* those are and nothing about content.
const RETIREMENT_SPECS: Record<Feature, RetirementSpec> = {
  rules: {
    kind: "file",
    supportedTargets: () => RulesProcessor.getToolTargets(),
    create: (params, config) =>
      new RulesProcessor({
        ...params,
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
      }),
    // A legacy root such as `.claude/CLAUDE.md` is listed for deletion when the
    // primary root is absent, but it is hand-authored: Rulesync reads it and
    // never writes it, so retiring the tool must leave it alone.
    unownedPaths: ({ toolTarget, outputRoot }) =>
      (
        toolRuleFactories
          .get(toolTarget as Parameters<typeof toolRuleFactories.get>[0])
          ?.class.getSettablePaths().alternativeRoots ?? []
      ).map((alt) => resolve(outputRoot, alt.relativeDirPath, alt.relativeFilePath)),
  },
  ignore: {
    kind: "file",
    supportedTargets: () => IgnoreProcessor.getToolTargets(),
    create: (params) => new IgnoreProcessor(params),
  },
  mcp: {
    kind: "file",
    supportedTargets: () => McpProcessor.getToolTargets(),
    create: (params) => new McpProcessor(params),
  },
  commands: {
    kind: "file",
    supportedTargets: (config) =>
      CommandsProcessor.getToolTargets({ includeSimulated: config.getSimulateCommands() }),
    create: (params, config) =>
      new CommandsProcessor({
        ...params,
        flattenedCommandNaming: config.getFlattenedCommandNaming(),
      }),
  },
  subagents: {
    kind: "file",
    supportedTargets: (config) =>
      SubagentsProcessor.getToolTargets({ includeSimulated: config.getSimulateSubagents() }),
    create: (params) => new SubagentsProcessor(params),
  },
  skills: {
    kind: "dir",
    supportedTargets: (config) =>
      SkillsProcessor.getToolTargets({ includeSimulated: config.getSimulateSkills() }),
    create: (params) => new SkillsProcessor(params),
  },
  hooks: {
    kind: "file",
    supportedTargets: () => HooksProcessor.getToolTargets(),
    create: (params, config) =>
      new HooksProcessor({ ...params, preserveUnownedHooks: config.getPreserveUnownedHooks() }),
  },
  permissions: {
    kind: "file",
    supportedTargets: () => PermissionsProcessor.getToolTargets(),
    create: (params) => new PermissionsProcessor(params),
  },
  checks: {
    kind: "file",
    supportedTargets: () => ChecksProcessor.getToolTargets(),
    create: (params) => new ChecksProcessor(params),
  },
};

/**
 * Whether this run may retire anything. Retirement is the one place where
 * leaving a target out means "delete it", so it only runs when the run covers
 * every target the configuration file declares: a target the run skips does
 * not register its outputs, and a file it shares with a retired one
 * (`AGENTS.md`, `.agents/skills/`) would otherwise look unclaimed. The resolver
 * already rejects `--retire-targets` with `--targets`; this check is what
 * protects a `Config` built directly.
 */
function canRetire({
  config,
  logger,
  sourceLoadFailed,
}: {
  config: Config;
  logger: Logger;
  sourceLoadFailed: boolean;
}): boolean {
  const retireTargets = config.getRetireTargets();
  if (retireTargets.length === 0) return false;

  const skipping = `Skipping retirement of ${retireTargets.join(", ")}`;
  // A step that could not read its source claims nothing, so a file it shares
  // with a retired target would look unclaimed. "Could not be read" is not "no
  // longer wanted", exactly as for the `--delete` sweeps.
  if (sourceLoadFailed) {
    logger.warn(`${skipping}: some .rulesync source files could not be read.`);
    return false;
  }
  if (config.getGlobal()) {
    logger.warn(`${skipping}: retireTargets is not supported in global mode.`);
    return false;
  }
  const runTargets = new Set(config.getTargets());
  const skippedTargets = config.getConfigFileTargets().filter((target) => !runTargets.has(target));
  if (skippedTargets.length > 0) {
    logger.warn(
      `${skipping}: this run does not include configured target(s) ${skippedTargets.join(", ")}.`,
    );
    return false;
  }
  return true;
}

/**
 * Schedule the deletion of every output a retired target would own, for each
 * feature of this run. "Owns" is exactly what `--delete` already removes when
 * a feature's source becomes empty — each processor's `forDeletion` listing —
 * so a shared settings file the tool merges into is never removed, and a file
 * beside the managed paths is never listed.
 *
 * The sweeps are deferred into the run's own plan, so a path that a still
 * configured target writes in this run is claimed and survives.
 */
export function scheduleRetiredTargetSweeps({
  config,
  logger,
  sweepPlan,
  sourceLoadFailed,
}: {
  config: Config;
  logger: Logger;
  sweepPlan: OrphanSweepPlan;
  sourceLoadFailed: boolean;
}): void {
  if (!canRetire({ config, logger, sourceLoadFailed })) return;

  for (const toolTarget of config.getRetireTargets()) {
    const outputRoots = config.getOutputRoots(toolTarget);
    if (outputRoots.length === 0) {
      logger.warn(
        `Cannot retire ${toolTarget}: 'outputRoots' has no entry for it, so its outputs cannot be located.`,
      );
      continue;
    }

    for (const feature of config.getFeatures()) {
      const spec = RETIREMENT_SPECS[feature];
      if (!spec.supportedTargets(config).includes(toolTarget)) continue;

      for (const outputRoot of outputRoots) {
        const params: ProcessorParams = {
          outputRoot,
          inputRoots: config.getInputRoots(),
          toolTarget,
          global: false,
          dryRun: config.isPreviewMode(),
          logger,
        };
        // Reported under the feature like any other sweep, so a `--json` plan
        // lists what retirement deletes.
        const featurePlan = sweepPlan.forFeature(feature);
        if (spec.kind === "file") {
          const processor = spec.create(params, config);
          const unownedPaths = new Set(spec.unownedPaths?.(params));
          featurePlan.defer({
            sweep: () => sweepFiles({ processor, sweepPlan, unownedPaths }),
            reportDeleted: () => processor.getRemovedPaths(),
          });
        } else {
          const processor = spec.create(params, config);
          featurePlan.defer({
            sweep: () => sweepDirs({ processor, sweepPlan }),
            reportDeleted: () => processor.getRemovedPaths(),
          });
        }
      }
    }
  }
}

async function sweepFiles({
  processor,
  sweepPlan,
  unownedPaths,
}: {
  processor: FeatureProcessor;
  sweepPlan: OrphanSweepPlan;
  unownedPaths: Set<string>;
}): Promise<boolean> {
  const candidates = sweepPlan
    .rejectClaimed({
      items: await processor.loadToolFiles({ forDeletion: true }),
      getPath: (f) => f.getFilePath(),
    })
    .filter((f) => !unownedPaths.has(resolve(f.getFilePath())));
  // Single-file features list their settable path whether or not it exists,
  // so a target that left nothing behind would otherwise report a deletion
  // on every run and keep `--check` failing.
  const present = await Promise.all(candidates.map((f) => fileExists(f.getFilePath())));
  const removed = await processor.removeOrphanAiFiles(
    candidates.filter((_, index) => present[index]),
    [],
  );
  return removed > 0;
}

async function sweepDirs({
  processor,
  sweepPlan,
}: {
  processor: DirFeatureProcessor;
  sweepPlan: OrphanSweepPlan;
}): Promise<boolean> {
  const removedDirs = await processor.removeOrphanAiDirs(
    sweepPlan.rejectClaimed({
      items: await processor.loadToolDirsToDelete(),
      getPath: (d) => d.getDirPath(),
    }),
    [],
  );
  const removedFlatFiles = await processor.removeOrphanFlatFiles({
    existingFlatFiles: sweepPlan.rejectClaimed({
      items: await processor.loadToolFlatFilesToDelete(),
      getPath: (d) => d.getFlatFilePath() ?? d.getDirPath(),
    }),
    generatedDirs: [],
  });
  return removedDirs + removedFlatFiles > 0;
}
