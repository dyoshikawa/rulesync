import { sep } from "node:path";

import type { GenerateResult } from "./generate.js";
import type { DeletedPath, KeyOperation } from "./orphan-sweep.js";

/**
 * Version of the `plan` document `generate --json` emits. Bump it whenever an
 * existing field changes meaning or a new `action`/`kind` value is added, so a
 * consumer that authorizes operations can refuse a plan it does not understand.
 *
 * - 1: `file`/`directory` writes and deletes.
 * - 2: adds `kind: "key"`, a top-level key of a shared config file.
 */
export const GENERATE_PLAN_VERSION = 2;

type GeneratePlanOperationBase = {
  action: "write" | "delete";
  feature: string;
  /** Relative to the output root, with `/` separators. */
  path: string;
};

export type GeneratePlanOperation =
  | (GeneratePlanOperationBase & { kind: "file" | "directory" })
  | (GeneratePlanOperationBase & {
      kind: "key";
      /**
       * A top-level key Rulesync owns outright in the shared config file at
       * `path`, which the same feature's `file` write operation rewrites.
       */
      key: string;
    });

export type GeneratePlan = {
  version: typeof GENERATE_PLAN_VERSION;
  operations: GeneratePlanOperation[];
};

/**
 * Flatten the per-feature results into one ordered list of operations:
 * features in the order the summary lists them, and within a feature its file
 * writes, then its shared-config key operations, then its deletions — paths
 * sorted within each, and keys within a path — so repeated previews of the
 * same tree produce identical plans and a preview can be compared with the
 * run it previews.
 */
export function buildGeneratePlan({
  featureResults,
  deletedPathsByFeature,
  keyOperationsByFeature,
}: {
  featureResults: Record<string, { paths: readonly string[] }>;
  deletedPathsByFeature: Readonly<Record<string, readonly DeletedPath[] | undefined>>;
  keyOperationsByFeature: Readonly<Record<string, readonly KeyOperation[] | undefined>>;
}): GeneratePlan {
  const toPlanPath = (path: string): string => path.split(sep).join("/");
  const operations: GeneratePlanOperation[] = [];

  for (const [feature, { paths }] of Object.entries(featureResults)) {
    for (const path of [...new Set(paths.map(toPlanPath))].toSorted()) {
      operations.push({ action: "write", kind: "file", feature, path });
    }
    for (const { action, path, key } of keyOperationsByFeature[feature] ?? []) {
      operations.push({ action, kind: "key", feature, path: toPlanPath(path), key });
    }
    for (const { path, kind } of deletedPathsByFeature[feature] ?? []) {
      operations.push({ action: "delete", kind, feature, path: toPlanPath(path) });
    }
  }

  return { version: GENERATE_PLAN_VERSION, operations };
}

/**
 * The per-feature written counts and paths of a run, keyed and ordered the way
 * `generate` reports them (the CLI summary, its `--json` `features` field, and
 * the plan). Kept in one place so the CLI and the MCP server cannot drift
 * apart when a feature is added.
 */
export function buildGenerateFeatureResults(
  result: GenerateResult,
): Record<string, { count: number; paths: string[] }> {
  return {
    ignore: { count: result.ignoreCount, paths: result.ignorePaths },
    mcp: { count: result.mcpCount, paths: result.mcpPaths },
    commands: { count: result.commandsCount, paths: result.commandsPaths },
    subagents: { count: result.subagentsCount, paths: result.subagentsPaths },
    skills: { count: result.skillsCount, paths: result.skillsPaths },
    hooks: { count: result.hooksCount, paths: result.hooksPaths },
    permissions: { count: result.permissionsCount, paths: result.permissionsPaths },
    checks: { count: result.checksCount, paths: result.checksPaths },
    rules: { count: result.rulesCount, paths: result.rulesPaths },
    activation: { count: result.activationCount, paths: result.activationPaths },
    pluginManifest: { count: result.pluginManifestCount, paths: result.pluginManifestPaths },
  };
}

/** The plan of everything a `generate` run wrote and deleted (or would, in preview mode). */
export function buildGeneratePlanFromResult(result: GenerateResult): GeneratePlan {
  return buildGeneratePlan({
    featureResults: buildGenerateFeatureResults(result),
    deletedPathsByFeature: result.deletedPathsByFeature,
    keyOperationsByFeature: result.keyOperationsByFeature,
  });
}
