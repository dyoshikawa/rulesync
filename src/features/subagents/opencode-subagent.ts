import { join } from "node:path";

import { z } from "zod/mini";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../../constants/opencode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  asOpencodeEntries,
  getOpencodeAgentEntries,
  mergeOpencodeEntryLayers,
  raiseOpencodeAgentToV2,
  readOpencodeConfigLayers,
  resolveOpencodeFileTemplate,
} from "../opencode-config.js";
import { OpenCodeStyleSubagent, OpenCodeStyleSubagentParams } from "./opencode-style-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/** Default `mode` applied to OpenCode subagents (single source of truth). */
const OPENCODE_DEFAULT_MODE = "subagent";

/**
 * Explicit OpenCode subagent frontmatter schema.
 *
 * Mirrors the strict-schema pattern applied to {@link KiloSubagent} (#1655):
 * the documented OpenCode agent fields are declared explicitly (instead of
 * aliasing the shared `OpenCodeStyleSubagent` base schema), tightening
 * validation and documenting the supported surface. The object stays
 * `looseObject` so forward-compatible/unknown fields still round-trip.
 * @see https://opencode.ai/docs/agents/
 */
export const OpenCodeSubagentFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  mode: z._default(z.string(), OPENCODE_DEFAULT_MODE),
  name: z.optional(z.string()),
  model: z.optional(z.string()),
  temperature: z.optional(z.number()),
  top_p: z.optional(z.number()),
  prompt: z.optional(z.string()),
  disable: z.optional(z.boolean()),
  // Hides a subagent from the `@` autocomplete menu; it stays invocable through
  // the task tool.
  hidden: z.optional(z.boolean()),
  // A hex color or a theme color name, shown in the UI.
  color: z.optional(z.string()),
  // Maximum agentic iterations before the agent must answer in text. It
  // supersedes the deprecated `maxSteps`, which still round-trips as an
  // unknown field.
  steps: z.optional(z.number().check(z.int(), z.gte(1))),
  // Default model variant for the agent (e.g. a provider reasoning preset).
  variant: z.optional(z.string()),
  // OpenCode accepts a per-tool enable map (`{ <tool>: boolean }`) as well as a
  // per-tool permission object, so both are kept permissive. OpenCode marks
  // `tools` as deprecated in favor of `permission`, but still reads it.
  tools: z.optional(z.record(z.string(), z.unknown())),
  permission: z.optional(z.union([z.string(), z.record(z.string(), z.unknown())])),
});
export type OpenCodeSubagentFrontmatter = z.infer<typeof OpenCodeSubagentFrontmatterSchema>;
export type OpenCodeSubagentParams = Omit<OpenCodeStyleSubagentParams, "frontmatter"> & {
  frontmatter: OpenCodeSubagentFrontmatter;
};

/**
 * Resolves an OpenCode agent's `prompt` (from `opencode.json`) into the
 * subagent body. OpenCode lets the prompt be a plain string or a
 * `"{file:./path}"` reference resolved relative to the config file's location
 * (`configDir`); a non-string prompt yields an empty body.
 *
 * @see https://opencode.ai/docs/agents/
 */
async function resolveOpenCodeAgentPrompt({
  prompt,
  configDir,
  containmentRoot,
}: {
  prompt: unknown;
  configDir: string;
  containmentRoot: string | undefined;
}): Promise<string> {
  if (typeof prompt !== "string") {
    return "";
  }
  return resolveOpencodeFileTemplate({ value: prompt, configDir, containmentRoot });
}

/**
 * Resolves the `prompt` of each inline agent entry of one config file against
 * that file's directory, so entries from several files can be merged without
 * losing where a `"{file:./path}"` reference points. `containmentRoot`, set at
 * project scope, keeps a reference from reading a file outside the project.
 */
async function resolveOpenCodeAgentPrompts({
  entries,
  configDir,
  containmentRoot,
}: {
  entries: Record<string, unknown> | null;
  configDir: string;
  containmentRoot: string | undefined;
}): Promise<Record<string, unknown> | null> {
  if (entries === null) {
    return null;
  }
  const resolved: Record<string, unknown> = {};
  for (const [name, rawEntry] of Object.entries(entries)) {
    const entry = asOpencodeEntries(rawEntry);
    const value =
      entry === null || !Object.hasOwn(entry, "prompt")
        ? rawEntry
        : {
            ...entry,
            prompt: await resolveOpenCodeAgentPrompt({
              prompt: entry.prompt,
              configDir,
              containmentRoot,
            }),
          };
    Object.defineProperty(resolved, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return resolved;
}

export class OpenCodeSubagent extends OpenCodeStyleSubagent {
  /** Directory layout; OpenCode forks (MiMo Code) override it. */
  protected static readonly layout: OpencodeLayout = OPENCODE_LAYOUT;

  declare protected readonly frontmatter: OpenCodeSubagentFrontmatter;

  constructor(params: OpenCodeSubagentParams) {
    // Apply the OpenCode schema (which also fills the `mode` default) up front so
    // the stored frontmatter is normalized and `validate()` stays side-effect-free.
    // The schema is a strict superset of the parent's, so the parent's own
    // validation is redundant — skip it with `validate: false`.
    let frontmatter = params.frontmatter;
    if (params.validate !== false) {
      const result = OpenCodeSubagentFrontmatterSchema.safeParse(params.frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(params.relativeDirPath, params.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
      frontmatter = result.data;
    }

    super({ ...params, frontmatter, validate: false });
  }

  protected getToolTarget(): Extract<ToolTarget, "opencode" | "opencodev1" | "kilo" | "mimocode"> {
    return (this.constructor as typeof OpenCodeSubagent).layout.toolTarget;
  }

  getFrontmatter(): OpenCodeSubagentFrontmatter {
    return this.frontmatter;
  }

  /**
   * For OpenCode V2, imports V1 agent fields in their V2 spelling so the
   * rulesync tool section holds what the V2 target writes back. `name` is
   * kept: the base class reads the rulesync name from it.
   */
  protected override getImportFrontmatter(): OpenCodeSubagentFrontmatter {
    if ((this.constructor as typeof OpenCodeSubagent).layout.configVersion !== "v2") {
      return this.frontmatter;
    }
    const { name, mode, description } = this.frontmatter;
    return {
      ...raiseOpencodeAgentToV2(this.frontmatter),
      mode,
      ...(description !== undefined && { description }),
      ...(name !== undefined && { name }),
    };
  }

  /**
   * Pure validation against the OpenCode schema (default application happens in
   * the constructor, not here), matching every sibling subagent.
   */
  validate(): ValidationResult {
    const result = OpenCodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSubagentSettablePaths {
    // OpenCode's canonical directory is the plural `agents/`. The singular
    // `agent/` is deprecated upstream (kept only for backwards compatibility),
    // so rulesync emits the plural form to match the documented convention.
    return {
      relativeDirPath: join(global ? this.layout.globalDir : this.layout.dir, "agents"),
    };
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const opencodeSection = rulesyncFrontmatter[this.layout.toolTarget] ?? {};

    // OpenCode V2 reads frontmatter carrying any V1-only field (`name`
    // included) as a V1 agent and ignores its V2 fields, so a V2 agent is
    // written in the V2 spelling alone, its ID coming from the file name.
    const parseResult = OpenCodeSubagentFrontmatterSchema.safeParse(
      this.layout.configVersion === "v2"
        ? raiseOpencodeAgentToV2({
            ...opencodeSection,
            description: rulesyncFrontmatter.description,
          })
        : {
            ...opencodeSection,
            description: rulesyncFrontmatter.description,
            ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
          },
    );

    if (!parseResult.success) {
      throw new Error(
        `Invalid frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(parseResult.error)}`,
      );
    }
    const opencodeFrontmatter: OpenCodeSubagentFrontmatter = parseResult.data;

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, opencodeFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot,
      frontmatter: opencodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: this.layout.toolTarget,
    });
  }

  /**
   * Imports agents defined inline in `opencode.json` / `opencode.jsonc` (and,
   * at project scope, `.opencode/opencode.json(c)`, which OpenCode merges over
   * them) under the top-level `agent` key — or its V2 spelling `agents`, see
   * `getOpencodeAgentEntries` — (in addition to the Markdown files under
   * `.opencode/agents/`). Each entry's `prompt` becomes the subagent body
   * (a `"{file:./path}"` reference is resolved relative to the config file's
   * location and, at project scope, only read when it resolves inside the
   * project); the remaining fields (`description` / `mode` / `model` /
   * `tools` / `permission` / ...) map to the frontmatter.
   *
   * Import-only: invoked by the subagents processor when loading tool files for
   * conversion to rulesync, never for orphan deletion.
   *
   * @see https://opencode.ai/docs/agents/#json
   */
  static async loadAdditionalImportFiles({
    outputRoot = process.cwd(),
    global = false,
  }: {
    outputRoot?: string;
    global?: boolean;
  } = {}): Promise<OpenCodeSubagent[]> {
    // Each file is lowered on its own and its `prompt` resolved against its
    // own directory before the files are merged, later files winning, as
    // OpenCode merges `.opencode/opencode.json(c)` over the root config.
    const layers = await readOpencodeConfigLayers({ outputRoot, global, layout: this.layout });
    const layerEntries = await Promise.all(
      layers.map(({ config, configDir }) =>
        resolveOpenCodeAgentPrompts({
          entries: getOpencodeAgentEntries({ config, layout: this.layout }),
          configDir,
          containmentRoot: global ? undefined : outputRoot,
        }),
      ),
    );
    const agentEntries = mergeOpencodeEntryLayers(layerEntries);
    if (!agentEntries) {
      return [];
    }

    const paths = this.getSettablePaths({ global });
    const subagents: OpenCodeSubagent[] = [];

    for (const [name, rawEntry] of Object.entries(agentEntries)) {
      const entry = asOpencodeEntries(rawEntry);
      if (!entry) {
        continue;
      }

      const { prompt, ...frontmatterFields } = entry;
      const body = typeof prompt === "string" ? prompt : "";

      const parseResult = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatterFields);
      if (!parseResult.success) {
        continue;
      }
      const frontmatter = parseResult.data;

      subagents.push(
        new this({
          outputRoot,
          frontmatter,
          body,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: `${name}.md`,
          fileContent: stringifyFrontmatter(body, frontmatter),
          validate: false,
          global,
        }),
      );
    }

    return subagents;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<OpenCodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): OpenCodeSubagent {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
