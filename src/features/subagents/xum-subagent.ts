import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { XUM_AGENTS_DIR_PATH } from "../../constants/xum-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * The built-in agent a rulesync subagent inherits from when its `xum` block
 * names neither a `base` nor its own `tools`. Xum gives an agent no tools at
 * all unless some agent in its `base` chain declares them, so a definition
 * without either would be a prompt that cannot read or edit anything.
 */
const XUM_DEFAULT_BASE_AGENT = "exec";

/**
 * Frontmatter of a Xum agent definition. `name` (the display name) is
 * required; the other documented fields are typed loosely and unknown keys are
 * kept (looseObject) so a round trip never drops them.
 *
 * @see https://xum.cdr.dev/agents
 */
const XumSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  base: z.optional(z.string()),
  disabled: z.optional(z.boolean()),
  ui: z.optional(z.looseObject({})),
  prompt: z.optional(z.looseObject({})),
  subagent: z.optional(z.looseObject({})),
  ai: z.optional(z.looseObject({})),
  tools: z.optional(z.looseObject({})),
});

export type XumSubagentFrontmatter = z.infer<typeof XumSubagentFrontmatterSchema>;

export type XumSubagentParams = {
  frontmatter: XumSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Subagent generator for Xum (formerly Mux).
 *
 * Xum reads custom agent definitions — Markdown with YAML frontmatter — from
 * the top level of `.xum/agents/` (project) and `~/.xum/agents/` (user); the
 * body is the agent's instruction prompt. The file name (without `.md`) is the
 * agent id, so it must be lowercase letters and digits with single `-` / `_`
 * separators; Xum skips other files with a warning.
 *
 * rulesync writes `name` and `description`, spreads the `xum` section (`base`,
 * `ui`, `prompt`, `subagent`, `ai`, `tools`, ...) on top, and fills two
 * defaults so the definition works as a delegated subagent out of the box:
 * `subagent.runnable: true` (required for `task({ agentId })` to spawn it) and,
 * when the section sets neither `base` nor `tools`, `base: exec`.
 *
 * @see https://xum.cdr.dev/agents
 */
export class XumSubagent extends ToolSubagent {
  private readonly frontmatter: XumSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: XumSubagentParams) {
    if (rest.validate !== false) {
      const result = XumSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  // Both scopes share the same relative path; the home-directory root is
  // applied by the processor in global mode.
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: XUM_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): XumSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name,
      description,
      ...(Object.keys(restFields).length > 0 && { xum: restFields }),
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

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const xumSection = this.filterToolSpecificSection(rulesyncFrontmatter.xum ?? {}, [
      "name",
      "description",
    ]);

    const subagentSection = xumSection.subagent;
    const result = XumSubagentFrontmatterSchema.safeParse({
      name: rulesyncFrontmatter.name,
      // Xum requires a non-empty `description` when one is present and drops a
      // definition whose frontmatter fails to parse, so an empty one is omitted.
      ...(rulesyncFrontmatter.description && { description: rulesyncFrontmatter.description }),
      ...(xumSection.base === undefined &&
        xumSection.tools === undefined && { base: XUM_DEFAULT_BASE_AGENT }),
      ...xumSection,
      subagent: {
        runnable: true,
        ...(isPlainObject(subagentSection) ? subagentSection : {}),
      },
    });
    if (!result.success) {
      throw new Error(
        `Invalid xum subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const body = rulesyncSubagent.getBody();

    return new XumSubagent({
      outputRoot,
      frontmatter: result.data,
      body,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent: stringifyFrontmatter(body, result.data),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: XumSubagentFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "xum",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<XumSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = XumSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new XumSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): XumSubagent {
    return new XumSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
