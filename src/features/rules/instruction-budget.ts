import { join, posix } from "node:path";

import { ToolFile } from "../../types/tool-file.js";
import { toPosixPath } from "../../utils/file.js";

/**
 * Normalizes a relative directory path for comparison: POSIX separators, no
 * `./` segments and no trailing slash, with the current directory as `"."`
 * (so `"./"`, `"a/"` and `"a"` compare the way `join()` groups them).
 */
export const normalizeRelativeDir = (dir: string): string =>
  posix.normalize(toPosixPath(dir)).replace(/\/+$/, "") || ".";

export type ProjectInstructionBudget = {
  bytes: number;
  remedy: string;
  readConfiguredBytes?: (outputRoot: string) => Promise<number | undefined>;
  configuredSource?: string;
  defaultLimitHint?: string;
};

/** One instruction file measured against a {@link ProjectInstructionBudget}. */
export type InstructionBudgetFile = {
  /** Directory relative to the output root, POSIX, `"."` for the root. */
  dir: string;
  /** File path relative to the output root, POSIX. */
  path: string;
  bytes: number;
};

/**
 * A budget problem found by {@link findProjectInstructionBudgetFindings}.
 * `kind: "disabled"` means the configured budget is `0`; `"over"` means a
 * chain exceeds the budget. `paths` lists the files involved (relative to the
 * output root), `primaryPath` the one to point at (the root file, or the
 * deepest file of a nested chain), and `remedy`, when present, is the fix to
 * suggest.
 */
export type InstructionBudgetFinding = {
  kind: "disabled" | "over";
  paths: string[];
  primaryPath: string;
  message: string;
  remedy?: string;
};

/**
 * Map a tool rule to the file the budget check measures. Pass the rule's
 * content as the tool reads it: generation passes what it will write, and
 * `doctor` the content already on disk.
 */
export const toInstructionBudgetFile = (
  rule: Pick<ToolFile, "getRelativeDirPath" | "getRelativeFilePath">,
  content: string,
): InstructionBudgetFile => ({
  // Drop a trailing slash (an explicit `subprojectPath: "a/"`) so the
  // ancestor test compares plain directory paths.
  dir: normalizeRelativeDir(rule.getRelativeDirPath()),
  path: toPosixPath(join(rule.getRelativeDirPath(), rule.getRelativeFilePath())),
  bytes: Buffer.byteLength(content, "utf8"),
});

/**
 * Check a project instruction chain against the tool's byte budget, shared by
 * `generate` (which logs each finding) and `doctor` (which reports each as a
 * warning diagnostic).
 *
 * Codex CLI concatenates the project `AGENTS.md` files from the project root
 * down to the cwd and stops once their combined size reaches
 * `project_doc_max_bytes`, truncating the file that crosses it — silently, so
 * without this check the rules past the limit simply never reach the model.
 * Each file is measured together with the files in its ancestor directories,
 * since that is the chain Codex loads while working there. When the root file
 * alone is over the budget every chain is, so only the root is reported;
 * likewise each over-budget nested chain is reported once, at its shallowest
 * directory. When `outputRoot` is not the cwd the message names it. An output
 * root below the git root is measured without the parent directories' files
 * Codex would also load, so the estimate can come out low there. The budget
 * checked is the value set in the output root's tool config when the tool
 * supports one (Codex's `project_doc_max_bytes` in `.codex/config.toml`), else
 * the tool's default; the message names which one it used. A configured budget
 * of `0` disables project docs in Codex, so that case yields a single
 * `disabled` finding saying the files will not be loaded instead of a size
 * report.
 */
export async function findProjectInstructionBudgetFindings({
  toolTarget,
  budget,
  outputRoot,
  files,
  fileOrigin = "generated",
}: {
  toolTarget: string;
  budget: ProjectInstructionBudget;
  outputRoot: string;
  files: InstructionBudgetFile[];
  /** How the messages describe the files: `generated` ones, or ones `on disk`. */
  fileOrigin?: "generated" | "on-disk";
}): Promise<InstructionBudgetFinding[]> {
  if (files.length === 0) {
    return [];
  }
  const configuredBytes = await budget.readConfiguredBytes?.(outputRoot);
  const location = outputRoot === process.cwd() ? "" : ` under '${outputRoot}'`;
  if (configuredBytes === 0) {
    const paths = files.map(({ path }) => path);
    return [
      {
        kind: "disabled",
        paths,
        primaryPath: paths[0] ?? "",
        message: `${budget.configuredSource ?? "The tool config"}${location} is set to 0, which disables ${toolTarget}'s project instruction files: the ${fileOrigin} ${paths.join(", ")} will not be loaded. Remove the setting or set it to a positive byte count to load them.`,
      },
    ];
  }
  const limitBytes = configuredBytes ?? budget.bytes;
  // Name the source of the budget only when the tool's config can change it.
  const limitLabel =
    budget.readConfiguredBytes === undefined
      ? `${limitBytes}-byte limit`
      : configuredBytes === undefined
        ? `${limitBytes}-byte default limit`
        : `${limitBytes}-byte limit set by ${budget.configuredSource ?? "the tool config"}`;
  const remedy =
    configuredBytes === undefined && budget.defaultLimitHint !== undefined
      ? `${budget.remedy} ${budget.defaultLimitHint}`
      : budget.remedy;

  const isAncestorOrSelf = (ancestor: string, dir: string): boolean =>
    ancestor === "." || ancestor === dir || dir.startsWith(`${ancestor}/`);

  const rootFiles = files.filter(({ dir }) => dir === ".");
  const rootBytes = rootFiles.reduce((sum, { bytes }) => sum + bytes, 0);
  if (rootBytes > limitBytes) {
    const paths = rootFiles.map(({ path }) => path);
    return [
      {
        kind: "over",
        paths,
        primaryPath: paths[0] ?? "",
        message: `The ${fileOrigin} ${toolTarget} root instruction file${location} (${paths.join(", ")}) is ${rootBytes} bytes, over the ${limitLabel}.`,
        remedy,
      },
    ];
  }

  // Report each over-budget chain once, at its shallowest nested file: every
  // deeper file below it is over budget too, so listing them adds nothing.
  const findings: InstructionBudgetFinding[] = [];
  const reportedDirs: string[] = [];
  const nestedFiles = files
    .filter(({ dir }) => dir !== ".")
    .toSorted((a, b) => a.dir.split("/").length - b.dir.split("/").length);
  for (const file of nestedFiles) {
    if (reportedDirs.some((dir) => isAncestorOrSelf(dir, file.dir))) {
      continue;
    }
    const chain = files.filter(({ dir }) => isAncestorOrSelf(dir, file.dir));
    const chainBytes = chain.reduce((sum, { bytes }) => sum + bytes, 0);
    if (chainBytes > limitBytes) {
      reportedDirs.push(file.dir);
      const paths = chain.map(({ path }) => path);
      findings.push({
        kind: "over",
        paths,
        primaryPath: file.path,
        message: `The ${fileOrigin} ${toolTarget} instruction files${location} loaded while working in '${file.dir}' (${paths.join(", ")}) total ${chainBytes} bytes, over the ${limitLabel} (as is every directory below it).`,
        remedy,
      });
    }
  }
  return findings;
}
