import { join } from "node:path";

import { z } from "zod/mini";

import { KIRO_AGENTS_DIR_PATH } from "../../constants/kiro-paths.js";
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
 * Frontmatter for Kiro **IDE** custom subagents (`.kiro/agents/*.md`). Unlike
 * the Kiro CLI (which uses JSON agent-config), the IDE reads Markdown files with
 * a YAML frontmatter block followed by the system-prompt body. The schema stays
 * loose for forward compatibility.
 *
 * @see https://kiro.dev/docs/chat/subagents/
 */
const KiroIdeSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  model: z.optional(z.string()),
  includeMcpJson: z.optional(z.boolean()),
  includePowers: z.optional(z.boolean()),
});

export type KiroIdeSubagentFrontmatter = z.infer<typeof KiroIdeSubagentFrontmatterSchema>;

export type KiroIdeSubagentParams = {
  frontmatter: KiroIdeSubagentFrontmatter;
  body: string;
} & AiFileParams;

export class KiroIdeSubagent extends ToolSubagent {
  private readonly frontmatter: KiroIdeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: KiroIdeSubagentParams) {
    if (rest.validate !== false) {
      const result = KiroIdeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({ ...rest });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: KIRO_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): KiroIdeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const kiroIdeSection: Record<string, unknown> = { ...restFields };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: name ?? this.getRelativeFilePath().replace(/\.md$/, ""),
      description: description ?? "",
      ...(Object.keys(kiroIdeSection).length > 0 && { "kiro-ide": kiroIdeSection }),
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
    const kiroIdeSection = this.filterToolSpecificSection(rulesyncFrontmatter["kiro-ide"] ?? {}, [
      "name",
      "description",
    ]);

    const rawFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...kiroIdeSection,
    };

    const result = KiroIdeSubagentFrontmatterSchema.safeParse(rawFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid kiro-ide subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const frontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, frontmatter);
    const paths = this.getSettablePaths({ global });

    return new KiroIdeSubagent({
      outputRoot,
      frontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    const result = KiroIdeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "kiro-ide",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KiroIdeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = KiroIdeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiroIdeSubagent({
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
  }: ToolSubagentForDeletionParams): KiroIdeSubagent {
    return new KiroIdeSubagent({
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
