import { basename, dirname, extname, join } from "node:path";

import { z } from "zod/mini";

import {
  DEVIN_AGENTS_DIR_PATH,
  DEVIN_GLOBAL_AGENTS_DIR_PATH,
} from "../../constants/devin-paths.js";
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

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3).
// Devin Local custom subagent profiles are native AGENT.md files with YAML
// frontmatter, stored in a directory-per-agent layout where the directory name
// is the profile id. See https://docs.devin.ai/cli/subagents
//   - `name`, `description`: identity fields.
//   - `model`, `allowed-tools`, `permissions`, `max-nesting`: optional
//     configuration fields, passed through verbatim when present.
const DevinSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
  "allowed-tools": z.optional(z.array(z.string())),
  permissions: z.optional(
    z.looseObject({
      allow: z.optional(z.array(z.string())),
      deny: z.optional(z.array(z.string())),
      ask: z.optional(z.array(z.string())),
    }),
  ),
  "max-nesting": z.optional(z.number()),
});

export type DevinSubagentFrontmatter = z.infer<typeof DevinSubagentFrontmatterSchema>;

export type DevinSubagentParams = {
  frontmatter: DevinSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * File name for each Devin custom subagent profile.
 *
 * Devin Local discovers a subagent as a named directory containing an
 * `AGENT.md` file (the directory name becomes the profile id), so each
 * subagent must live at `.devin/agents/<name>/AGENT.md` (project) or
 * `~/.config/devin/agents/<name>/AGENT.md` (global).
 *
 * @see https://docs.devin.ai/cli/subagents
 */
const DEVIN_SUBAGENT_FILE_NAME = "AGENT.md";

export class DevinSubagent extends ToolSubagent {
  private readonly frontmatter: DevinSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: DevinSubagentParams) {
    if (rest.validate !== false) {
      const result = DevinSubagentFrontmatterSchema.safeParse(frontmatter);
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
    // Devin custom subagent profiles use different paths for project and global
    // modes. The home directory is resolved by the processor through outputRoot
    // in global mode:
    // - Project mode: {process.cwd()}/.devin/agents/
    // - Global mode: {getHomeDirectory()}/.config/devin/agents/
    return {
      relativeDirPath: global ? DEVIN_GLOBAL_AGENTS_DIR_PATH : DEVIN_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): DevinSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;

    const devinSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      ...(Object.keys(devinSection).length > 0 && { devin: devinSection }),
    };

    return new RulesyncSubagent({
      outputRoot: this.getOutputRoot(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      // The tool-side path is `<name>/AGENT.md`; the rulesync file is a flat
      // `<name>.md`, so the subagent name comes from the parent directory.
      relativeFilePath: `${this.getSubagentName()}.md`,
      validate: true,
    });
  }

  /**
   * Derive the subagent name from this instance's relative file path.
   *
   * The tool-side layout is `<name>/AGENT.md`, so the name is the parent
   * directory of the file. If the path is unexpectedly flat (e.g. a legacy
   * `<name>.md`), fall back to the basename without extension.
   */
  private getSubagentName(): string {
    const relativeFilePath = this.getRelativeFilePath();
    const dir = dirname(relativeFilePath);
    if (dir && dir !== ".") {
      return basename(dir);
    }
    return basename(relativeFilePath, extname(relativeFilePath));
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const devinSection = this.filterToolSpecificSection(rulesyncFrontmatter.devin ?? {}, [
      "name",
      "description",
    ]);

    const rawDevinFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...devinSection,
    };

    const result = DevinSubagentFrontmatterSchema.safeParse(rawDevinFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid devin subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const devinFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, devinFrontmatter);

    const paths = this.getSettablePaths({ global });

    // The rulesync subagent is a flat `<name>.md`; Devin requires a
    // directory-per-agent layout, so emit `<name>/AGENT.md`.
    const subagentName = basename(
      rulesyncSubagent.getRelativeFilePath(),
      extname(rulesyncSubagent.getRelativeFilePath()),
    );

    return new DevinSubagent({
      outputRoot,
      frontmatter: devinFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: join(subagentName, DEVIN_SUBAGENT_FILE_NAME),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = DevinSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "devin",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<DevinSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = DevinSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new DevinSubagent({
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
  }: ToolSubagentForDeletionParams): DevinSubagent {
    return new DevinSubagent({
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
