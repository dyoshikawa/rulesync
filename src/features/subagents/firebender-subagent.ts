import { basename, join, posix } from "node:path";

import { z } from "zod/mini";

import {
  FIREBENDER_AGENTS_DIR_NAME,
  FIREBENDER_AGENTS_DIR_PATH,
  FIREBENDER_CONFIG_FILE_NAME,
  FIREBENDER_DIR,
  getFirebenderConfigDir,
} from "../../constants/firebender-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Frontmatter of a Firebender agent file. `tools` is a comma-separated string
 * of tool groups (`read`, `edit`, `execution`, `other`) and MCP tools
 * (`mcp_<server>_<tool>`); `model` is `small`, `medium`, `large`, `inherit` or a
 * model ID; `callable` lets the main agent delegate to it. Unknown keys are
 * preserved.
 *
 * @see https://docs.firebender.com/api-reference/agents
 */
const FirebenderSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  color: z.optional(z.string()),
  icon: z.optional(z.string()),
  tools: z.optional(z.string()),
  model: z.optional(z.string()),
  callable: z.optional(z.boolean()),
});

type FirebenderSubagentFrontmatter = z.infer<typeof FirebenderSubagentFrontmatterSchema>;

type FirebenderSubagentParams = {
  frontmatter: FirebenderSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * The `agents` entry Firebender resolves to an agent file rulesync writes:
 * relative to the project root for the project config, and to `~/.firebender`
 * for the personal one.
 */
function toAgentsEntry({
  relativeFilePath,
  global,
}: {
  relativeFilePath: string;
  global: boolean;
}): string {
  const fileName = toPosixPath(relativeFilePath);
  return global
    ? posix.join(FIREBENDER_AGENTS_DIR_NAME, fileName)
    : posix.join(toPosixPath(FIREBENDER_AGENTS_DIR_PATH), fileName);
}

/**
 * Whether an existing `agents` entry points into the directory rulesync owns
 * (`.firebender/agents/` in the project, `~/.firebender/agents/` globally).
 * Those entries are recomputed from the generated agents on every run; any
 * other entry (`~/firebender-agents/...`, an absolute path) is left alone.
 */
function isManagedAgentsEntry({ entry, global }: { entry: string; global: boolean }): boolean {
  const normalized = toPosixPath(entry).replace(/^\.\//, "");
  const prefix = global
    ? `${FIREBENDER_AGENTS_DIR_NAME}/`
    : `${toPosixPath(FIREBENDER_AGENTS_DIR_PATH)}/`;
  const homePrefix = `~/${toPosixPath(FIREBENDER_AGENTS_DIR_PATH)}/`;
  const rest = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : global && normalized.startsWith(homePrefix)
      ? normalized.slice(homePrefix.length)
      : undefined;
  return rest !== undefined && rest.endsWith(".md") && !rest.includes("/");
}

/**
 * Subagent generator for Firebender.
 *
 * Each agent is a Markdown file with YAML frontmatter, written to
 * `.firebender/agents/<name>.md` (project) or `~/.firebender/agents/<name>.md`
 * (global). Firebender only loads agents listed in the `agents` array of
 * `firebender.json`, so generation also registers every file there — see
 * {@link FirebenderAgentsRegistry}. Rulesync subagents are meant to be
 * delegated to, so `callable: true` is written unless the `firebender:`
 * section says otherwise.
 *
 * @see https://docs.firebender.com/api-reference/agents
 */
export class FirebenderSubagent extends ToolSubagent {
  private readonly frontmatter: FirebenderSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: FirebenderSubagentParams) {
    if (rest.validate !== false) {
      const result = FirebenderSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }
    super({ ...rest });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return {
      relativeDirPath: FIREBENDER_AGENTS_DIR_PATH,
    };
  }

  /**
   * Generation also read-modify-writes the `agents` key of `firebender.json`,
   * so the write is declared for the shared-file order derivation.
   */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    return [
      {
        relativeDirPath: getFirebenderConfigDir({ global }),
        relativeFilePath: FIREBENDER_CONFIG_FILE_NAME,
      },
    ];
  }

  getFrontmatter(): FirebenderSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, callable, ...rest } = this.frontmatter;
    // `callable: true` is what generation writes by default, so only a
    // different value needs carrying.
    const firebenderSection: Record<string, unknown> = {
      ...rest,
      ...(callable !== undefined && callable !== true && { callable }),
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? basename(this.getRelativeFilePath(), ".md"),
      description,
      ...(Object.keys(firebenderSection).length > 0 && { firebender: firebenderSection }),
    };

    return new RulesyncSubagent({
      outputRoot: ".", // RulesyncSubagent outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  /**
   * Every targeted subagent becomes its own agent file, plus one
   * {@link FirebenderAgentsRegistry} that lists them in `firebender.json`.
   * The registry is emitted even when no subagent is targeted, so agents a
   * previous run registered are retracted.
   */
  static fromRulesyncSubagents({
    outputRoot = process.cwd(),
    rulesyncSubagents,
    global = false,
    logger,
  }: {
    outputRoot?: string;
    rulesyncSubagents: RulesyncSubagent[];
    global?: boolean;
    logger?: Logger;
  }): ToolSubagent[] {
    const subagents = rulesyncSubagents.map((rulesyncSubagent) =>
      this.fromRulesyncSubagent({
        outputRoot,
        relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
        rulesyncSubagent,
        global,
      }),
    );
    const registry = new FirebenderAgentsRegistry({
      outputRoot,
      relativeDirPath: getFirebenderConfigDir({ global }),
      relativeFilePath: FIREBENDER_CONFIG_FILE_NAME,
      entries: subagents.map((subagent) =>
        toAgentsEntry({ relativeFilePath: subagent.getRelativeFilePath(), global }),
      ),
      global,
      logger,
    });
    return [...subagents, registry];
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): FirebenderSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const firebenderSection = rulesyncFrontmatter.firebender ?? {};

    const frontmatter: FirebenderSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      callable: true,
      ...firebenderSection,
    };

    const body = rulesyncSubagent.getBody();
    return new FirebenderSubagent({
      outputRoot,
      frontmatter,
      body,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent: stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true }),
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = FirebenderSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "firebender",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<FirebenderSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = FirebenderSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new FirebenderSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): FirebenderSubagent {
    return new FirebenderSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}

type FirebenderAgentsRegistryParams = Omit<AiFileParams, "fileContent"> & {
  entries: string[];
  logger?: Logger;
};

/**
 * The `agents` array of `firebender.json`, which Firebender requires to load
 * an agent file. Entries pointing into rulesync's agent directory are
 * recomputed from the generated agents (so a removed subagent is
 * unregistered); every other entry and every other key of the file is kept.
 * The array is merged into the file on disk at write time and the file itself
 * is never deleted.
 */
export class FirebenderAgentsRegistry extends ToolSubagent {
  private readonly entries: string[];
  private readonly logger: Logger | undefined;
  private mergedContent: string | null = null;

  constructor({ entries, logger, ...rest }: FirebenderAgentsRegistryParams) {
    super({ ...rest, fileContent: "" });
    this.entries = entries;
    this.logger = logger;
  }

  getEntries(): string[] {
    return this.entries;
  }

  override isDeletable(): boolean {
    return false;
  }

  override shouldMergeExistingFileContent(): boolean {
    return true;
  }

  override setFileContent(newFileContent: string): void {
    this.mergedContent = this.mergeInto(newFileContent);
  }

  override getFileContent(): string {
    if (this.mergedContent === null) {
      this.mergedContent = this.mergeInto("");
    }
    return this.mergedContent;
  }

  private mergeInto(existingContent: string): string {
    const paths = {
      relativeDirPath: this.getRelativeDirPath(),
      relativeFilePath: this.getRelativeFilePath(),
    };
    const filePath = join(this.getOutputRoot(), paths.relativeDirPath, paths.relativeFilePath);
    const existing = parseSharedConfig({
      format: "json",
      fileContent: existingContent,
      filePath,
      invalidRootPolicy: "error",
    });
    const existingEntries = Array.isArray(existing.agents) ? existing.agents : [];
    const kept = existingEntries.filter(
      (entry) => typeof entry !== "string" || !isManagedAgentsEntry({ entry, global: this.global }),
    );
    const dropped = existingEntries.filter(
      (entry): entry is string =>
        typeof entry === "string" &&
        isManagedAgentsEntry({ entry, global: this.global }) &&
        !this.entries.includes(toPosixPath(entry).replace(/^\.\//, "")),
    );
    if (dropped.length > 0) {
      const sourceDir = this.global
        ? `~/${toPosixPath(FIREBENDER_DIR)}/${FIREBENDER_AGENTS_DIR_NAME}/`
        : `${toPosixPath(FIREBENDER_AGENTS_DIR_PATH)}/`;
      this.logger?.warn(
        `Unregistered Firebender agent(s) ${dropped.map((entry) => quoteValueForWarning(entry)).join(", ")} from ${filePath}: ` +
          `rulesync recomputes the "agents" entries under ${sourceDir} from .rulesync/subagents/ on every run.`,
      );
    }
    const agents = [...kept, ...this.entries.filter((entry) => !kept.includes(entry))];

    return applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "subagents",
      existingContent,
      patch: { agents: agents.length > 0 ? agents : undefined },
      filePath,
      logger: this.logger,
    });
  }

  toRulesyncSubagent(): RulesyncSubagent {
    throw new Error(
      `${this.getRelativePathFromCwd()} registers Firebender agents and is not a subagent itself.`,
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
