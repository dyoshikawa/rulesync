import { join } from "node:path";

import { z } from "zod/mini";

import {
  ANTIGRAVITY_AGENTS_DIR_PATH,
  ANTIGRAVITY_GLOBAL_AGENTS_DIR_PATH,
} from "../../constants/antigravity-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Frontmatter of an Antigravity custom agent (Markdown format, CLI v1.1.6+).
 *
 * `name` and `description` are required upstream; the rest are optional and
 * documented with defaults (`tools: []`, `mainAgent: true`, `subagent: true`,
 * `model: inherit`, `commandExecutionPolicy: sandbox`, `mcpServers: []`,
 * `skills`/`plugins`: `[]`). `hidden` and `inheritMcp` appear in the v1.1.6
 * release notes but not in the documented frontmatter table, so they are
 * accepted as verbatim passthrough without any behavior modeled around them.
 * `looseObject` keeps unknown future fields round-tripping.
 *
 * @see https://antigravity.google/docs/subagents
 */
export const AntigravitySubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string().check(z.minLength(1)),
  tools: z.optional(z.array(z.string())),
  mainAgent: z.optional(z.boolean()),
  subagent: z.optional(z.boolean()),
  model: z.optional(z.string()),
  commandExecutionPolicy: z.optional(z.string()),
  mcpServers: z.optional(z.array(z.unknown())),
  skills: z.optional(z.array(z.string())),
  plugins: z.optional(z.array(z.string())),
  hidden: z.optional(z.boolean()),
  inheritMcp: z.optional(z.boolean()),
});

export type AntigravitySubagentFrontmatter = z.infer<typeof AntigravitySubagentFrontmatterSchema>;

/**
 * Tool-specific rulesync sections every writer of the shared
 * `.agents/agents/<name>.md` file merges, in increasing precedence order.
 */
export const ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS = [
  "antigravity-ide",
  "antigravity-cli",
] as const satisfies readonly ToolTarget[];

export type AntigravitySharedSubagentParams = {
  frontmatter: AntigravitySubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Build the frontmatter an `.agents/agents/<name>.md` file carries.
 *
 * That path is shared: every Antigravity target writes it, and so does the
 * simulated `agentsmd` target, which has no format of its own. Exporting the
 * construction — rather than letting each writer assemble its own — is what
 * keeps the file identical whichever target runs last, the same arrangement
 * `toSpecConformantAgentSkillFields` already gives `.agents/skills/`.
 *
 * `sectionKeys` are the rulesync frontmatter sections to merge, in increasing
 * precedence order; `toolTarget` only names the writer in the error message.
 */
export function toAntigravitySubagentFrontmatter({
  rulesyncSubagent,
  sectionKeys,
  toolTarget,
}: {
  rulesyncSubagent: RulesyncSubagent;
  sectionKeys: readonly ToolTarget[];
  toolTarget: ToolTarget;
}): AntigravitySubagentFrontmatter {
  const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
  const mergedSection = Object.assign(
    {},
    ...sectionKeys.map((key) => rulesyncFrontmatter[key] ?? {}),
  ) as Record<string, unknown>;
  const { name: _name, description: _description, ...toolSection } = mergedSection;

  const rawFrontmatter = {
    name: rulesyncFrontmatter.name,
    // Antigravity refuses to load an agent without a description, so a
    // canonical file that omits it gets a minimal generated one rather than
    // an inert output file.
    description: rulesyncFrontmatter.description || `${rulesyncFrontmatter.name} subagent`,
    ...toolSection,
  };

  const result = AntigravitySubagentFrontmatterSchema.safeParse(rawFrontmatter);
  if (!result.success) {
    throw new Error(
      `Invalid ${toolTarget} subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Render the bytes an `.agents/agents/<name>.md` file carries.
 *
 * Frontmatter construction alone is not enough to keep the shared file
 * identical between writers — the serialization has to match too, so it lives
 * here rather than being hand-copied at each call site.
 */
export function stringifyAntigravitySubagentFile({
  body,
  frontmatter,
}: {
  body: string;
  frontmatter: AntigravitySubagentFrontmatter;
}): string {
  return stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true });
}

/**
 * Shared custom-agent (subagent) implementation for Google Antigravity 2.0,
 * used by the IDE, the CLI and plugin bundles.
 *
 * Antigravity discovers agents at `.agents/agents/<name>.md` (project) and
 * `~/.gemini/config/agents/<name>.md` (global, shared by the IDE and the CLI
 * exactly like `~/.gemini/config/hooks.json`). The directory form
 * (`<name>/agent.md`) is an equivalent alternative upstream; rulesync emits and
 * imports the flat file form. The body after the frontmatter is the agent's
 * system prompt.
 *
 * Concrete subclasses only supply the rulesync target name they answer to via
 * {@link AntigravitySharedSubagent.getToolTarget} and, where the shared file is
 * not involved, the sections they read via
 * {@link AntigravitySharedSubagent.getReadSectionKeys}.
 *
 * @see https://antigravity.google/docs/subagents
 */
export class AntigravitySharedSubagent extends ToolSubagent {
  private readonly frontmatter: AntigravitySubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: AntigravitySharedSubagentParams) {
    if (rest.validate !== false) {
      const result = AntigravitySubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyAntigravitySubagentFile({ body, frontmatter }),
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  /** The rulesync target name this subagent answers to. */
  protected static getToolTarget(): ToolTarget {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Tool-specific sections this target reads, in increasing precedence order.
   *
   * `antigravity-ide` and `antigravity-cli` write the very same file, so a
   * target that read only its own section would silently drop the other's keys
   * — and which one survived would depend on `--targets` order. Every target
   * therefore merges the shared `antigravity-ide` → `antigravity-cli` sections
   * (the CLI block wins, matching the fixed order the MCP feature already uses
   * for the same shared-output reason), and the plugin target layers its own
   * section on top of that. Only `getToolTarget()` decides which section an
   * import writes back into.
   */
  protected static getReadSectionKeys(): ToolTarget[] {
    return [...ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS];
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? ANTIGRAVITY_GLOBAL_AGENTS_DIR_PATH : ANTIGRAVITY_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): AntigravitySubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      // `tools` / `model` and every tool-specific key round-trip through the
      // section named after the target that read the file; every Antigravity
      // target reads that section back (see getReadSectionKeys), so importing
      // through one target and generating for another loses nothing.
      ...(Object.keys(restFields).length > 0 && {
        [(this.constructor as typeof AntigravitySharedSubagent).getToolTarget()]: restFields,
      }),
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = toAntigravitySubagentFrontmatter({
      rulesyncSubagent,
      sectionKeys: this.getReadSectionKeys(),
      toolTarget: this.getToolTarget(),
    });
    const body = rulesyncSubagent.getBody();
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot,
      frontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent: stringifyAntigravitySubagentFile({ body, frontmatter }),
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = AntigravitySubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: this.getToolTarget(),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<AntigravitySharedSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = AntigravitySubagentFrontmatterSchema.safeParse(frontmatter);
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
  }: ToolSubagentForDeletionParams): AntigravitySharedSubagent {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
