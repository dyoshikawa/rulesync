import { basename, join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Where Vibe reads a custom system prompt from: `.vibe/prompts/<id>.md`
 * (project) and `~/.vibe/prompts/<id>.md` (user), with the custom directories
 * winning over the builtins. The id must be a bare file name with no path
 * separators.
 * @see vibe/core/prompts/__init__.py
 */
export const VIBE_PROMPTS_DIR_PATH = join(".vibe", "prompts");

type VibeSubagentsFromRulesyncSubagentsParams = {
  rulesyncSubagents: RulesyncSubagent[];
  outputRoot?: string;
  global?: boolean;
};

/**
 * Vibe resolves a `system_prompt_id` by file name, and
 * `VibeConfigSchema._check_system_prompt` evaluates it during validation — an
 * unresolvable id raises and the agent is dropped at discovery. The id must
 * therefore stay a bare slug with no path separators.
 */
function promptSlug(relativeFilePath: string): string {
  return basename(relativeFilePath)
    .replace(/\.(md|toml)$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

export const VibeSubagentTomlSchema = z.looseObject({
  agent_type: z.enum(["agent", "subagent"]),
  display_name: z.optional(z.string()),
  description: z.optional(z.string()),
  safety: z.optional(z.string()),
  active_model: z.optional(z.string()),
  system_prompt: z.optional(z.string()),
  system_prompt_id: z.optional(z.string()),
  compaction_prompt: z.optional(z.string()),
  compaction_prompt_id: z.optional(z.string()),
  enabled_tools: z.optional(z.array(z.string())),
  disabled_tools: z.optional(z.array(z.string())),
  tools: z.optional(z.record(z.string(), z.looseObject({}))),
});

type VibeSubagentToml = z.infer<typeof VibeSubagentTomlSchema>;

export type VibeSubagentParams = {
  body: string;
  /**
   * True for the companion `.vibe/prompts/<id>.md` file, whose body is Markdown
   * rather than agent TOML and therefore must not be schema-validated.
   */
  promptFile?: boolean;
  /** The system prompt resolved from `system_prompt_id` during import. */
  resolvedSystemPrompt?: string;
} & AiFileParams;

export class VibeSubagent extends ToolSubagent {
  private readonly body: string;
  private readonly promptFile: boolean;
  private readonly resolvedSystemPrompt: string | undefined;

  constructor({ body, promptFile = false, resolvedSystemPrompt, ...rest }: VibeSubagentParams) {
    if (rest.validate !== false && !promptFile) {
      try {
        VibeSubagentTomlSchema.parse(smolToml.parse(body));
      } catch (error) {
        throw new Error(
          `Invalid TOML in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(error)}`,
          { cause: error },
        );
      }
    }

    super({ ...rest });
    this.body = body;
    this.promptFile = promptFile;
    this.resolvedSystemPrompt = resolvedSystemPrompt;
  }

  /** True for the companion `.vibe/prompts/<id>.md` file. */
  isPromptFile(): boolean {
    return this.promptFile;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".vibe", "agents"),
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    let parsed: VibeSubagentToml;
    try {
      parsed = VibeSubagentTomlSchema.parse(smolToml.parse(this.body));
    } catch (error) {
      throw new Error(
        `Failed to parse TOML in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const { system_prompt, system_prompt_id, description, display_name, ...vibeSection } = parsed;
    // A `system_prompt_id` resolved to a prompt file becomes the canonical body,
    // so the id is not carried into the `vibe:` section — regenerating derives
    // it from the file stem. An id we could NOT resolve is kept so the agent
    // still points at whatever prompt the user maintains by hand.
    const resolvedBody = this.resolvedSystemPrompt ?? system_prompt;
    const unresolvedPromptId =
      this.resolvedSystemPrompt === undefined ? system_prompt_id : undefined;
    const fileStem = basename(this.getRelativeFilePath(), ".toml");
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["vibe"],
      name: display_name ?? fileStem,
      ...(description !== undefined && { description }),
      vibe: {
        ...(display_name !== undefined && { display_name }),
        ...(description !== undefined && { description }),
        ...(unresolvedPromptId !== undefined && { system_prompt_id: unresolvedPromptId }),
        ...vibeSection,
      },
    };

    return new RulesyncSubagent({
      outputRoot: this.outputRoot,
      frontmatter: rulesyncFrontmatter,
      body: resolvedBody ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.toml$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection: Record<string, unknown> = frontmatter.vibe ?? {};
    const vibeSection = this.filterToolSpecificSection(rawSection, [
      "agent_type",
      "display_name",
      "description",
      "system_prompt",
    ]);

    const promptBody = rulesyncSubagent.getBody();
    // Vibe's settable field is `system_prompt_id`; `system_prompt` is a
    // read-only property on `VibeSchema` and pydantic's `extra="ignore"` drops
    // the key silently, so an agent written with it loads with the DEFAULT
    // system prompt. The body therefore goes to `.vibe/prompts/<slug>.md` and
    // the agent references it by id — the mechanism upstream's own builtin
    // profiles use (`EXPLORE` sets `"system_prompt_id": "explore"`).
    const slug = promptSlug(rulesyncSubagent.getRelativeFilePath());

    const tomlObj: VibeSubagentToml = {
      agent_type: rawSection.agent_type === "agent" ? "agent" : "subagent",
      display_name:
        typeof rawSection.display_name === "string" ? rawSection.display_name : frontmatter.name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      ...vibeSection,
      // A generated prompt file always wins over an authored `system_prompt_id`:
      // the two would otherwise disagree about which prompt the body lives in.
      ...(promptBody ? { system_prompt_id: slug } : {}),
    };

    const body = smolToml.stringify(tomlObj);
    const paths = this.getSettablePaths({ global });
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".toml");

    return new VibeSubagent({
      outputRoot,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: body,
      validate,
      global,
    });
  }

  /**
   * Emits the agent TOML plus its companion prompt file. The prompt file MUST
   * be written together with the id: `VibeConfigSchema._check_system_prompt`
   * evaluates the property during validation, so an unresolvable
   * `system_prompt_id` raises and `AgentRegistry._try_load` drops the agent
   * with a warning.
   */
  static fromRulesyncSubagents({
    rulesyncSubagents,
    outputRoot = process.cwd(),
    global = false,
  }: VibeSubagentsFromRulesyncSubagentsParams): VibeSubagent[] {
    return rulesyncSubagents.flatMap((rulesyncSubagent) => {
      const agentFile = VibeSubagent.fromRulesyncSubagent({
        outputRoot,
        relativeDirPath: VibeSubagent.getSettablePaths({ global }).relativeDirPath,
        rulesyncSubagent,
        global,
      }) as VibeSubagent;

      const promptBody = rulesyncSubagent.getBody();
      if (!promptBody) {
        return [agentFile];
      }

      const slug = promptSlug(rulesyncSubagent.getRelativeFilePath());
      return [
        agentFile,
        new VibeSubagent({
          outputRoot,
          body: promptBody,
          relativeDirPath: VIBE_PROMPTS_DIR_PATH,
          relativeFilePath: `${slug}.md`,
          fileContent: promptBody,
          promptFile: true,
          validate: false,
          global,
        }),
      ];
    });
  }

  validate(): ValidationResult {
    try {
      VibeSubagentTomlSchema.parse(smolToml.parse(this.body));
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "vibe",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<VibeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    // Recover the body a `system_prompt_id` points at, so a hand-written Vibe
    // agent using the real mechanism does not import with an empty body.
    // `system_prompt` stays accepted as a legacy read.
    const resolvedSystemPrompt = await VibeSubagent.readSystemPrompt({
      outputRoot,
      fileContent,
    });

    const subagent = new VibeSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
      global,
      ...(resolvedSystemPrompt !== undefined && { resolvedSystemPrompt }),
    });

    if (validate) {
      const result = subagent.validate();
      if (!result.success) {
        throw new Error(`Invalid TOML in ${filePath}: ${formatError(result.error)}`);
      }
    }

    return subagent;
  }

  /**
   * Read `.vibe/prompts/<id>.md` for an agent that names a `system_prompt_id`.
   * Returns `undefined` when there is no id or the file is missing, in which
   * case import falls back to the legacy `system_prompt` key.
   */
  private static async readSystemPrompt({
    outputRoot,
    fileContent,
  }: {
    outputRoot: string;
    fileContent: string;
  }): Promise<string | undefined> {
    let promptId: unknown;
    try {
      promptId = VibeSubagentTomlSchema.parse(smolToml.parse(fileContent)).system_prompt_id;
    } catch {
      return undefined;
    }
    // A bare slug only: upstream refuses ids containing a path separator, and
    // honoring one here would read outside the prompts directory.
    if (typeof promptId !== "string" || promptId === "" || /[\\/]/.test(promptId)) {
      return undefined;
    }
    return (
      (await readFileContentOrNull(join(outputRoot, VIBE_PROMPTS_DIR_PATH, `${promptId}.md`))) ??
      undefined
    );
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): VibeSubagent {
    return new VibeSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
