import { join } from "node:path";

import { z } from "zod/mini";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../../constants/opencode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  asOpencodeEntries,
  getOpencodeCommandEntries,
  mergeOpencodeEntryLayers,
  readOpencodeConfigLayers,
} from "../opencode-config.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

export const OpenCodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  agent: z.optional(z.string()),
  subtask: z.optional(z.boolean()),
  // OpenCode V2 spelling of `subtask` (V2 keeps `subtask` as a deprecated
  // alias). OpenCode V1 only knows `subtask`, so rulesync folds `subagent`
  // into `subtask` on both import and generate; see `foldSubagentAlias`.
  subagent: z.optional(z.boolean()),
  model: z.optional(z.string()),
  // Default model variant for the command (e.g. a provider reasoning preset).
  variant: z.optional(z.string()),
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

export class OpenCodeCommand extends FrontmatterMarkdownToolCommand<OpenCodeCommandFrontmatter> {
  /** Directory layout; OpenCode forks (MiMo Code) override it. */
  protected static readonly layout: OpencodeLayout = OPENCODE_LAYOUT;

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    // OpenCode's canonical directory is the plural `commands/`. The singular
    // `command/` is deprecated upstream (kept only for backwards compatibility),
    // so rulesync emits the plural form to match the documented convention and
    // its own plural `.opencode/plugins` hooks output.
    return {
      relativeDirPath: join(global ? this.layout.globalDir : this.layout.dir, "commands"),
    };
  }

  /** Also the tool-scoped section of the Rulesync frontmatter. */
  protected static override getToolTarget(): ToolTarget {
    return this.layout.toolTarget;
  }

  protected static override getFrontmatterSchema() {
    return OpenCodeCommandFrontmatterSchema;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): OpenCodeCommandFrontmatter {
    const toolSection = rulesyncFrontmatter[this.layout.toolTarget] ?? {};
    const opencodeFields =
      this.layout.configVersion === "v2"
        ? raiseToOpencodeV2CommandFields(toolSection)
        : foldSubagentAlias(toolSection);

    return {
      description: rulesyncFrontmatter.description,
      ...opencodeFields,
    };
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const { description, ...toolFields } = this.frontmatter;
    const { toolTarget, configVersion } = (this.constructor as typeof OpenCodeCommand).layout;
    const restFields =
      configVersion === "v2"
        ? raiseToOpencodeV2CommandFields(toolFields)
        : foldSubagentAlias(toolFields);

    return {
      targets: ["*"],
      description,
      ...(Object.keys(restFields).length > 0 && { [toolTarget]: restFields }),
    };
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
}
