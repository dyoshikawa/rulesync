import { join } from "node:path";

import { z } from "zod/mini";

import { OMP_AGENTS_DIR_NAME, OMP_DIR, OMP_GLOBAL_DIR } from "../../constants/omp-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
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
 * Frontmatter of an oh-my-pi agent definition (`parseAgentFields` in
 * `packages/coding-agent/src/discovery/helpers.ts`). oh-my-pi skips a file
 * without both `name` and `description`; the other keys (`tools`, `model`,
 * `spawns`, `thinkingLevel`, `blocking`, ...) pass through unchanged.
 */
const OmpSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

type OmpSubagentFrontmatter = z.infer<typeof OmpSubagentFrontmatterSchema>;

type OmpSubagentParams = {
  frontmatter: OmpSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Subagent generator for oh-my-pi (`omp`): `.omp/agents/*.md` (project) and
 * `~/.omp/agent/agents/*.md` (global, default profile). Keys under the `omp:`
 * section of a rulesync subagent are copied into the frontmatter verbatim.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/task-agent-discovery.md
 */
export class OmpSubagent extends ToolSubagent {
  private readonly frontmatter: OmpSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: OmpSubagentParams) {
    if (rest.validate !== false) {
      const result = OmpSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(global ? OMP_GLOBAL_DIR : OMP_DIR, OMP_AGENTS_DIR_NAME),
    };
  }

  getFrontmatter(): OmpSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...rest } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      omp: {
        ...rest,
      },
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
    const ompSection = rulesyncFrontmatter.omp ?? {};

    const ompFrontmatter: OmpSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      // oh-my-pi ignores an agent without a description, so fall back to the
      // name rather than emit a file that is never loaded.
      description: rulesyncFrontmatter.description ?? rulesyncFrontmatter.name,
      ...ompSection,
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, ompFrontmatter, { avoidBlockScalars: true });
    const paths = this.getSettablePaths({ global });

    return new OmpSubagent({
      outputRoot: outputRoot,
      frontmatter: ompFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = OmpSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "omp",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<OmpSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = OmpSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OmpSubagent({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: relativeFilePath,
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
  }: ToolSubagentForDeletionParams): OmpSubagent {
    return new OmpSubagent({
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
