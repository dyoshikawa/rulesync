import { join } from "node:path";

import { z } from "zod/mini";

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

const RovodevSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

type RovodevSubagentFrontmatter = z.infer<typeof RovodevSubagentFrontmatterSchema>;

type RovodevSubagentParams = {
  frontmatter: RovodevSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Rovo Dev CLI subagents: markdown with YAML frontmatter plus body (system prompt).
 *
 * - **Project:** `.rovodev/subagents/*.md`
 * - **User:** `~/.rovodev/subagents/*.md` (same relative path under home when syncing with `--global`)
 *
 * Optional frontmatter fields such as `tools` are preserved under the rulesync `rovodev` key on round-trip.
 *
 * @see https://support.atlassian.com/rovo/docs/use-subagents-in-rovo-dev-cli/
 */
export class RovodevSubagent extends ToolSubagent {
  private readonly frontmatter: RovodevSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RovodevSubagentParams) {
    if (rest.validate !== false) {
      const result = RovodevSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".rovodev", "subagents"),
    };
  }

  getFrontmatter(): RovodevSubagentFrontmatter {
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
      rovodev: {
        ...rest,
      },
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
  }: ToolSubagentFromRulesyncSubagentParams): RovodevSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const rovodevSection = rulesyncFrontmatter.rovodev ?? {};

    const rovodevFrontmatter: RovodevSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...rovodevSection,
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, rovodevFrontmatter, { avoidBlockScalars: true });
    const paths = this.getSettablePaths({ global });

    return new RovodevSubagent({
      outputRoot,
      frontmatter: rovodevFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    const result = RovodevSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "rovodev",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<RovodevSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = RovodevSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new RovodevSubagent({
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
  }: ToolSubagentForDeletionParams): RovodevSubagent {
    const paths = this.getSettablePaths({ global });
    return new RovodevSubagent({
      outputRoot,
      relativeDirPath: relativeDirPath ?? paths.relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
