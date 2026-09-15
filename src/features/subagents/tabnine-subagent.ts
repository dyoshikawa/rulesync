import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { TABNINE_AGENTS_DIR_PATH } from "../../constants/tabnine-paths.js";
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

// Tabnine CLI subagent frontmatter. `name` and `description` are required by
// the tool; the remaining keys are the documented optional fields. Unknown keys
// pass through so newer Tabnine releases keep round-tripping.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/subagents
const TabnineSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  /** "local" (default) runs inside the CLI; "remote" delegates to a Tabnine cloud agent. */
  kind: z.optional(z.string()),
  /** Built-in tool names the subagent may use; omitted = every tool. */
  tools: z.optional(z.array(z.string())),
  model: z.optional(z.string()),
  /** Sampling temperature, 0.0-2.0. */
  temperature: z.optional(z.number()),
  /** Maximum agent turns (Tabnine default: 15). */
  max_turns: z.optional(z.number()),
  /** Wall-clock budget in minutes (Tabnine default: 5). */
  timeout_mins: z.optional(z.number()),
});

type TabnineSubagentFrontmatter = z.infer<typeof TabnineSubagentFrontmatterSchema>;

type TabnineSubagentParams = {
  frontmatter: TabnineSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Tabnine CLI subagent: a Markdown file with YAML frontmatter under
 * `.tabnine/agent/agents/` (project) or `~/.tabnine/agent/agents/` (user).
 * Tabnine only loads these when `experimental.enableAgents` is `true` in its
 * settings; rulesync writes the files and leaves that flag to the user.
 */
export class TabnineSubagent extends ToolSubagent {
  private readonly frontmatter: TabnineSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: TabnineSubagentParams) {
    if (rest.validate !== false) {
      const result = TabnineSubagentFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: TABNINE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): TabnineSubagentFrontmatter {
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
      tabnine: {
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
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const tabnineSection = rulesyncFrontmatter.tabnine ?? {};

    // Tabnine refuses a subagent without a `description`, so a rulesync
    // subagent that states none is reported here rather than written as a
    // file the tool would not load.
    const rawFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...tabnineSection,
    };
    const result = TabnineSubagentFrontmatterSchema.safeParse(rawFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid tabnine subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }
    const tabnineSubagentFrontmatter: TabnineSubagentFrontmatter = result.data;

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, tabnineSubagentFrontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new TabnineSubagent({
      outputRoot,
      frontmatter: tabnineSubagentFrontmatter,
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

    const result = TabnineSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "tabnine",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<TabnineSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = TabnineSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new TabnineSubagent({
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
  }: ToolSubagentForDeletionParams): TabnineSubagent {
    return new TabnineSubagent({
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
