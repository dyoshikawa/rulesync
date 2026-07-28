import { join } from "node:path";

import { z } from "zod/mini";

import {
  GOOSE_AGENTS_DIR_PATH,
  GOOSE_GLOBAL_AGENTS_DIR_PATH,
} from "../../constants/goose-paths.js";
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
 * Goose custom agents (v1.34.0+) are Markdown files with YAML frontmatter —
 * `name` (required), `description` and `model` (optional) — whose body is the
 * agent's instructions; agents are invocable via `@name` or delegation.
 * `looseObject` keeps unknown future fields round-tripping.
 *
 * Earlier rulesync versions emitted subagents as sub-recipe YAML under
 * `.goose/recipes/subagents/`, a location Goose's filesystem agent discovery
 * never scans (a sub-recipe is only reachable from a parent recipe's
 * `sub_recipes` list, which rulesync never wrote) — so those files were inert.
 * The custom-agent surface is the one Goose actually reads.
 *
 * @see https://block.github.io/goose/docs/guides/context-engineering/custom-agents/
 */
export const GooseSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
});

export type GooseSubagentFrontmatter = z.infer<typeof GooseSubagentFrontmatterSchema>;

export type GooseSubagentParams = {
  frontmatter: GooseSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

export class GooseSubagent extends ToolSubagent {
  private readonly frontmatter: GooseSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: GooseSubagentParams) {
    if (rest.validate !== false) {
      const result = GooseSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Project `.goose/agents/` and global `~/.config/goose/agents/` — the
    // goose-specific compatibility dirs of Goose's agent discovery, so the
    // output cannot collide with a future shared `.agents/agents/` target.
    return {
      relativeDirPath: global ? GOOSE_GLOBAL_AGENTS_DIR_PATH : GOOSE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): GooseSubagentFrontmatter {
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
      // `model` and any future field round-trip through the goose section.
      ...(Object.keys(restFields).length > 0 && { goose: restFields }),
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
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    // Recipe-only keys from the retired sub-recipe surface (or from a canonical
    // file imported by an earlier rulesync version, which always carried
    // `version`) are stripped: they have no meaning on a custom-agent file and
    // would land in its frontmatter as inert noise. In particular, the old
    // `goose.instructions` used to override the emitted body — on the
    // custom-agent surface the body IS the instructions, so the override is
    // gone by design.
    const gooseSection = this.filterToolSpecificSection(rulesyncFrontmatter.goose ?? {}, [
      "name",
      "description",
      "version",
      "title",
      "instructions",
      "prompt",
      "extensions",
      "parameters",
      "sub_recipes",
    ]);

    const rawFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...gooseSection,
    };

    const result = GooseSubagentFrontmatterSchema.safeParse(rawFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid goose subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const gooseFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, gooseFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new GooseSubagent({
      outputRoot,
      frontmatter: gooseFrontmatter,
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

    const result = GooseSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "goose",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<GooseSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = GooseSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new GooseSubagent({
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
  }: ToolSubagentForDeletionParams): GooseSubagent {
    return new GooseSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
