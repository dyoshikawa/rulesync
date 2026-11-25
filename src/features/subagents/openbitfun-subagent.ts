import { join } from "node:path";

import { z } from "zod/mini";

import {
  OPENBITFUN_AGENTS_DIR_PATH,
  openbitfunGlobalAgentsDir,
} from "../../constants/openbitfun-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  parseGeneratedSubagentFrontmatter,
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * The `kind` rulesync writes: a delegated subagent rather than a top-level
 * agent mode. It is also OpenBitFun's default when `kind` is omitted.
 */
const OPENBITFUN_SUBAGENT_KIND = "subagent";

/**
 * Frontmatter of an OpenBitFun custom agent. `name` and `description` are
 * required; `tools` is a list or a comma-separated string. Unknown keys are
 * kept (looseObject), and OpenBitFun itself ignores keys it does not know.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/custom_agent.rs
 */
const OpenbitfunSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  kind: z.optional(z.enum(["mode", "subagent"])),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  model: z.optional(z.string()),
  readonly: z.optional(z.boolean()),
  review: z.optional(z.boolean()),
});

export type OpenbitfunSubagentFrontmatter = z.infer<typeof OpenbitfunSubagentFrontmatterSchema>;

export type OpenbitfunSubagentParams = {
  frontmatter: OpenbitfunSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Subagent generator for OpenBitFun.
 *
 * OpenBitFun reads custom agents — Markdown with YAML frontmatter, the body
 * being the prompt — from `.openbitfun/agents/` (project) and
 * `<user root>/agents/` (user; see {@link openbitfunGlobalAgentsDir}).
 *
 * rulesync writes `name`, `description` and `kind: subagent`, then spreads the
 * `openbitfun` section (`kind`, `tools`, `model`, `readonly`, `review`, `id`,
 * `user_context_policy`, ...) on top, so a value set there wins. OpenBitFun
 * requires `description`, so an absent one is written as an empty string.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/custom_agent.rs
 */
export class OpenbitfunSubagent extends ToolSubagent {
  private readonly frontmatter: OpenbitfunSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: OpenbitfunSubagentParams) {
    if (rest.validate !== false) {
      const result = OpenbitfunSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? openbitfunGlobalAgentsDir() : OPENBITFUN_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): OpenbitfunSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, kind, ...restFields } = this.frontmatter;
    // `kind: subagent` is what generation writes by default, so it is not
    // carried into the section; any other kind is.
    const openbitfunSection = {
      ...(kind !== undefined && kind !== OPENBITFUN_SUBAGENT_KIND && { kind }),
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name,
      ...(description && { description }),
      ...(Object.keys(openbitfunSection).length > 0 && { openbitfun: openbitfunSection }),
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
    const openbitfunSection = this.filterToolSpecificSection(rulesyncFrontmatter.openbitfun ?? {}, [
      "name",
      "description",
    ]);

    const openbitfunFrontmatter = parseGeneratedSubagentFrontmatter({
      schema: OpenbitfunSubagentFrontmatterSchema,
      frontmatter: {
        name: rulesyncFrontmatter.name,
        description: rulesyncFrontmatter.description ?? "",
        kind: OPENBITFUN_SUBAGENT_KIND,
        ...openbitfunSection,
      },
      toolTarget: "openbitfun",
      rulesyncSubagent,
    });

    const body = rulesyncSubagent.getBody();

    return new OpenbitfunSubagent({
      outputRoot,
      frontmatter: openbitfunFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent: stringifyFrontmatter(body, openbitfunFrontmatter),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: OpenbitfunSubagentFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "openbitfun",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<OpenbitfunSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = OpenbitfunSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OpenbitfunSubagent({
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
  }: ToolSubagentForDeletionParams): OpenbitfunSubagent {
    return new OpenbitfunSubagent({
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
