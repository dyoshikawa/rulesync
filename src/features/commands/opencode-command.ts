import { join } from "node:path";

import { optional, z } from "zod/mini";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../../constants/opencode-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  asOpencodeEntries,
  getOpencodeCommandEntries,
  mergeOpencodeEntryLayers,
  readOpencodeConfigLayers,
} from "../opencode-config.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export const OpenCodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  agent: optional(z.string()),
  subtask: optional(z.boolean()),
  // OpenCode V2 spelling of `subtask` (V2 keeps `subtask` as a deprecated
  // alias). OpenCode V1 only knows `subtask`, so rulesync folds `subagent`
  // into `subtask` on both import and generate; see `foldSubagentAlias`.
  subagent: optional(z.boolean()),
  model: optional(z.string()),
  // Default model variant for the command (e.g. a provider reasoning preset).
  variant: optional(z.string()),
});

export type OpenCodeCommandFrontmatter = z.infer<typeof OpenCodeCommandFrontmatterSchema>;

/**
 * Rewrites a boolean `subagent` (OpenCode V2) into `subtask`, the key both V1
 * and V2 read: V1's command schema rejects unknown keys, while V2 resolves
 * `subagent ?? subtask`. `subagent` therefore wins when both are set, matching
 * V2. A non-boolean `subagent` is left untouched for validation to report.
 *
 * @see https://opencode.ai/v2/docs/commands/
 */
function foldSubagentAlias<T extends Record<string, unknown>>(
  fields: T,
): T | (Omit<T, "subagent"> & { subtask: boolean }) {
  if (typeof fields.subagent !== "boolean") {
    return fields;
  }
  const { subagent, ...rest } = fields;
  return { ...rest, subtask: subagent };
}

/**
 * Raises V1 command fields to the OpenCode V2 spelling: `subtask` becomes
 * `subagent` (an existing boolean `subagent` wins, as V2 resolves
 * `subagent ?? subtask`), and `variant` is joined onto `model` as
 * `provider/model#variant`. V2 has no separate `variant`, so a `variant`
 * without a `model` (or with a `model` that already names a variant) is
 * dropped. Values of an unexpected type are left untouched for validation to
 * report.
 *
 * @see https://opencode.ai/v2/docs/migrate-v1/
 */
function raiseToOpencodeV2CommandFields<T extends Record<string, unknown>>(
  fields: T,
): Record<string, unknown> {
  const { subtask, variant, ...rest }: Record<string, unknown> = fields;
  const raised: Record<string, unknown> = { ...rest };
  if (typeof subtask === "boolean") {
    if (typeof raised.subagent !== "boolean") {
      raised.subagent = subtask;
    }
  } else if (subtask !== undefined) {
    raised.subtask = subtask;
  }
  if (typeof variant === "string") {
    if (typeof raised.model === "string" && !raised.model.includes("#") && variant !== "") {
      raised.model = `${raised.model}#${variant}`;
    }
  } else if (variant !== undefined) {
    raised.variant = variant;
  }
  return raised;
}

export type OpenCodeCommandParams = {
  frontmatter: OpenCodeCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class OpenCodeCommand extends ToolCommand {
  /** Directory layout; OpenCode forks (MiMo Code) override it. */
  protected static readonly layout: OpencodeLayout = OPENCODE_LAYOUT;

  private readonly frontmatter: OpenCodeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: OpenCodeCommandParams) {
    if (rest.validate) {
      const result = OpenCodeCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    // OpenCode's canonical directory is the plural `commands/`. The singular
    // `command/` is deprecated upstream (kept only for backwards compatibility),
    // so rulesync emits the plural form to match the documented convention and
    // its own plural `.opencode/plugins` hooks output.
    return {
      relativeDirPath: join(global ? this.layout.globalDir : this.layout.dir, "commands"),
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...toolFields } = this.frontmatter;
    const { toolTarget, configVersion } = (this.constructor as typeof OpenCodeCommand).layout;
    const restFields =
      configVersion === "v2"
        ? raiseToOpencodeV2CommandFields(toolFields)
        : foldSubagentAlias(toolFields);

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      ...(Object.keys(restFields).length > 0 && { [toolTarget]: restFields }),
    };

    return new RulesyncCommand({
      outputRoot: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): OpenCodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const toolSection = rulesyncFrontmatter[this.layout.toolTarget] ?? {};
    const opencodeFields =
      this.layout.configVersion === "v2"
        ? raiseToOpencodeV2CommandFields(toolSection)
        : foldSubagentAlias(toolSection);

    const opencodeFrontmatter: OpenCodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...opencodeFields,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot: outputRoot,
      frontmatter: opencodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = OpenCodeCommandFrontmatterSchema.safeParse(this.frontmatter);
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

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<OpenCodeCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = OpenCodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new this({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: this.layout.toolTarget,
    });
  }

  /**
   * Imports commands defined inline in `opencode.json` / `opencode.jsonc` (and,
   * at project scope, `.opencode/opencode.json(c)`, which OpenCode merges over
   * them) under the top-level `command` key — or its V2 spelling `commands`, see
   * `getOpencodeCommandEntries` — (in addition to the Markdown files under
   * `.opencode/commands/`). Each entry's `template` becomes the command body,
   * while `description` / `agent` / `model` / `variant` / `subtask` map to the
   * frontmatter (a V2 `subagent` is read as `subtask`, taking precedence like
   * V2 does).
   *
   * Import-only: this is invoked by the commands processor when loading tool
   * files for conversion to rulesync, never for orphan deletion.
   *
   * @see https://opencode.ai/docs/commands/#json
   */
  static async loadAdditionalImportFiles({
    outputRoot = process.cwd(),
    global = false,
  }: {
    outputRoot?: string;
    global?: boolean;
  } = {}): Promise<OpenCodeCommand[]> {
    // Each file is lowered on its own and later files win, as OpenCode merges
    // `.opencode/opencode.json(c)` over the root config.
    const layers = await readOpencodeConfigLayers({ outputRoot, global, layout: this.layout });
    const commandEntries = mergeOpencodeEntryLayers(
      layers.map(({ config }) => getOpencodeCommandEntries({ config, layout: this.layout })),
    );
    if (!commandEntries) {
      return [];
    }

    const paths = this.getSettablePaths({ global });
    const commands: OpenCodeCommand[] = [];

    for (const [name, rawEntry] of Object.entries(commandEntries)) {
      const entry = asOpencodeEntries(rawEntry);
      if (!entry) {
        continue;
      }

      const body = typeof entry.template === "string" ? entry.template : "";
      const { subtask } = foldSubagentAlias(entry);
      const v1Frontmatter: OpenCodeCommandFrontmatter = {
        ...(typeof entry.description === "string" && { description: entry.description }),
        ...(typeof entry.agent === "string" && { agent: entry.agent }),
        ...(typeof entry.model === "string" && { model: entry.model }),
        ...(typeof entry.variant === "string" && { variant: entry.variant }),
        ...(typeof subtask === "boolean" && { subtask }),
      };
      const frontmatter: OpenCodeCommandFrontmatter =
        this.layout.configVersion === "v2"
          ? raiseToOpencodeV2CommandFields(v1Frontmatter)
          : v1Frontmatter;

      commands.push(
        new this({
          outputRoot,
          frontmatter,
          body,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: `${name}.md`,
          validate: false,
        }),
      );
    }

    return commands;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): OpenCodeCommand {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
