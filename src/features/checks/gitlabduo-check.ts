import { basename, join } from "node:path";

import { dump } from "js-yaml";
import { z } from "zod/mini";

import {
  GITLABDUO_DIR,
  GITLABDUO_MR_REVIEW_INSTRUCTIONS_FILE_NAME,
} from "../../constants/gitlabduo-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { fileExists, readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import { slugifyCheckName } from "./check-slug.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
  type ToolCheckSettablePaths,
} from "./tool-check.js";

/**
 * The `gitlabduo` block of a check's frontmatter: the instruction group's
 * display `name` (GitLab quotes it in review comments) and its optional
 * `fileFilters` globs, neither of which the canonical check model carries.
 */
const GitlabduoCheckOverrideSchema = z.looseObject({
  name: z.optional(z.string().check(z.minLength(1))),
  fileFilters: z.optional(z.array(z.string().check(z.minLength(1)))),
});
type GitlabduoCheckOverride = z.infer<typeof GitlabduoCheckOverrideSchema>;

type GitlabduoInstruction = { name: string; fileFilters?: string[]; instructions: string };

function parseOverride(raw: unknown, filePath: string, logger?: Logger): GitlabduoCheckOverride {
  if (raw === undefined) {
    return {};
  }
  if (!isPlainObject(raw)) {
    logger?.warn(`Ignoring the \`gitlabduo\` block in ${filePath}: expected a mapping.`);
    return {};
  }
  const result = GitlabduoCheckOverrideSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid \`gitlabduo\` block in ${filePath}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}

function stemOf(rulesyncCheck: RulesyncCheck): string {
  return basename(rulesyncCheck.getRelativeFilePath(), ".md");
}

function uniqueName(preferred: string, used: Set<string>): string {
  let name = preferred;
  let suffix = 2;
  while (used.has(name)) {
    name = `${preferred}-${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

/**
 * The check body is the instruction text GitLab Duo acts on; the frontmatter
 * `description` is only a fallback, and the check name the last resort so the
 * group never carries empty instructions.
 */
function toInstructionText(rulesyncCheck: RulesyncCheck): string {
  const body = rulesyncCheck.getBody().trim();
  if (body.length > 0) {
    return body;
  }
  return rulesyncCheck.getFrontmatter().description?.trim() || stemOf(rulesyncCheck);
}

function parseInstructionsFile(fileContent: string, filePath: string): Record<string, unknown> {
  if (fileContent.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = loadYaml(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse GitLab Duo review instructions at ${filePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse GitLab Duo review instructions at ${filePath}: expected a mapping at the document root.`,
    );
  }
  return parsed;
}

/** An entry missing `name` or `instructions` is not one GitLab reads, so it is skipped. */
function readInstruction(raw: unknown): GitlabduoInstruction | undefined {
  if (!isPlainObject(raw)) return undefined;
  const name = typeof raw.name === "string" ? raw.name : undefined;
  const instructions = typeof raw.instructions === "string" ? raw.instructions : undefined;
  if (!name || !instructions) return undefined;
  const fileFilters = Array.isArray(raw.fileFilters)
    ? raw.fileFilters.filter((filter): filter is string => typeof filter === "string")
    : undefined;
  return { name, ...(fileFilters && fileFilters.length > 0 && { fileFilters }), instructions };
}

/**
 * Checks adapter for GitLab Duo Code Review Flow's custom review instructions
 * (`.gitlab/duo/mr-review-instructions.yaml`).
 *
 * The file holds a list of instruction groups, each a `name`, optional
 * `fileFilters` globs, and the `instructions` text. Rulesync maps one
 * `.rulesync/checks/*.md` onto one group: `name` defaults to the check's file
 * stem (override with `gitlabduo.name`), `fileFilters` comes from
 * `gitlabduo.fileFilters`, and the body becomes `instructions`. GitLab has no
 * severity or tool-permission fields, so those are not emitted.
 *
 * **Generation merges rather than replaces.** GitLab documents this file as
 * hand-written, so only the groups whose `name` the current check set claims
 * are rewritten (in place); every other group and any other top-level key
 * survive. For the same reason, an existing file is never deleted.
 *
 * Project scope only: the review runs in GitLab against the committed
 * repository, and there is no user-level file.
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/review_instructions/
 */
export class GitlabduoCheck extends ToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers such as the gitignore derivation from
    // claiming the whole `.gitlab/duo/` directory.
    return {
      relativeDirPath: GITLABDUO_DIR,
      relativeFilePath: GITLABDUO_MR_REVIEW_INSTRUCTIONS_FILE_NAME,
    };
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({ rulesyncCheck, toolTarget: "gitlabduo" });
  }

  /**
   * YAML carries no marker saying which groups are rulesync's, so an existing
   * file may hold hand-written instructions and is never deleted.
   */
  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const paths = GitlabduoCheck.getSettablePaths();
    const filePath = join(
      outputRoot,
      paths.relativeDirPath,
      paths.relativeFilePath ?? GITLABDUO_MR_REVIEW_INSTRUCTIONS_FILE_NAME,
    );
    return !(await fileExists(filePath));
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): GitlabduoCheck {
    throw new Error("GitLab Duo checks are built from all checks at once; use fromRulesyncChecks.");
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
    logger,
  }: ToolCheckFromRulesyncChecksParams): Promise<GitlabduoCheck[]> {
    const paths = GitlabduoCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? GITLABDUO_MR_REVIEW_INSTRUCTIONS_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const existing = parseInstructionsFile((await readFileContentOrNull(filePath)) ?? "", filePath);
    const existingInstructions = Array.isArray(existing.instructions) ? existing.instructions : [];

    if (rulesyncChecks.length === 0) {
      if (existingInstructions.length > 0) {
        logger?.warn(
          `GitLab Duo checks: no check targets GitLab Duo, but ${filePath} still holds review ` +
            `instructions. They are left in place — rulesync cannot tell the ones it generated ` +
            `from ones you wrote, so removing them is a manual edit.`,
        );
      }
      return [];
    }

    const usedNames = new Set<string>();
    const generated: GitlabduoInstruction[] = rulesyncChecks.map((rulesyncCheck) => {
      const override = parseOverride(
        rulesyncCheck.getFrontmatter().gitlabduo,
        join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, rulesyncCheck.getRelativeFilePath()),
        logger,
      );
      return {
        name: uniqueName(override.name ?? stemOf(rulesyncCheck), usedNames),
        ...(override.fileFilters &&
          override.fileFilters.length > 0 && { fileFilters: override.fileFilters }),
        instructions: toInstructionText(rulesyncCheck),
      };
    });

    // Replace claimed groups in place, keep every other entry verbatim, and
    // append groups that are new.
    const byName = new Map(generated.map((instruction) => [instruction.name, instruction]));
    const merged: unknown[] = existingInstructions.map((raw) => {
      const name = isPlainObject(raw) && typeof raw.name === "string" ? raw.name : undefined;
      const replacement = name !== undefined ? byName.get(name) : undefined;
      if (replacement && name !== undefined) {
        byName.delete(name);
        return replacement;
      }
      return raw;
    });
    merged.push(...byName.values());

    const fileContent = dump(
      { ...existing, instructions: merged },
      { lineWidth: -1, noRefs: true },
    );

    return [
      new GitlabduoCheck({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath,
        fileContent,
        global,
      }),
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<GitlabduoCheck> {
    const paths = GitlabduoCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? GITLABDUO_MR_REVIEW_INSTRUCTIONS_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    return new GitlabduoCheck({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: (await readFileContentOrNull(filePath)) ?? "",
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCheckForDeletionParams): GitlabduoCheck {
    return new GitlabduoCheck({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncCheck(): RulesyncCheck {
    const first = this.toRulesyncChecks()[0];
    if (!first) {
      throw new Error(
        `No review instructions found in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}.`,
      );
    }
    return first;
  }

  /** One check per instruction group; the group's name and filters ride along in `gitlabduo`. */
  override toRulesyncChecks(): RulesyncCheck[] {
    const filePath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    const parsed = parseInstructionsFile(this.getFileContent(), filePath);
    const rawInstructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];

    const checks: RulesyncCheck[] = [];
    const usedFileNames = new Set<string>();
    for (const raw of rawInstructions) {
      const instruction = readInstruction(raw);
      if (!instruction) continue;
      const fileName = uniqueName(slugifyCheckName(instruction.name) || "check", usedFileNames);
      checks.push(
        new RulesyncCheck({
          outputRoot: ".",
          relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
          relativeFilePath: `${fileName}.md`,
          frontmatter: {
            targets: ["*"],
            gitlabduo: {
              name: instruction.name,
              ...(instruction.fileFilters && { fileFilters: instruction.fileFilters }),
            },
          },
          body: instruction.instructions.trim(),
        }),
      );
    }
    return checks;
  }
}
