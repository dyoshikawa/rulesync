import { basename, dirname, extname, join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  REASONIX_SUBAGENT_INVOCATION,
  REASONIX_SUBAGENT_RUN_AS,
  REASONIX_SUBAGENTS_DIR_PATH,
} from "../../constants/reasonix-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatterWithYamlRepair, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3).
// DeepSeek-Reasonix native subagents are Skill profiles: an Anthropic-style
// `<name>/SKILL.md` whose YAML frontmatter marks the skill as a manually
// invoked subagent. The directory name is the profile id.
// See https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SUBAGENT_PROFILES.md
//   - `name`, `description`: identity fields.
//   - `invocation`, `runAs`: the markers that turn a Skill into a subagent
//     profile (`invocation: manual`, `runAs: subagent`).
//   - `model`, `effort`, `allowed-tools`, `color`: optional configuration
//     fields, passed through verbatim when present.
const ReasonixSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  invocation: z.optional(z.string()),
  runAs: z.optional(z.string()),
  model: z.optional(z.string()),
  effort: z.optional(z.string()),
  "allowed-tools": z.optional(z.array(z.string())),
  color: z.optional(z.string()),
});

export type ReasonixSubagentFrontmatter = z.infer<typeof ReasonixSubagentFrontmatterSchema>;

export type ReasonixSubagentParams = {
  frontmatter: ReasonixSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Represents a DeepSeek-Reasonix subagent profile.
 *
 * Reasonix discovers subagents as directory-layout Skills (`<name>/SKILL.md`)
 * under `.reasonix/skills/` (project) and `~/.reasonix/skills/` (global); the
 * global scope is served by the processor supplying the home directory as
 * outputRoot, so the relative directory path is identical for both scopes. A
 * subagent is a Skill whose frontmatter declares `invocation: manual` and
 * `runAs: subagent`.
 *
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SUBAGENT_PROFILES.md
 */
export class ReasonixSubagent extends ToolSubagent {
  private readonly frontmatter: ReasonixSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: ReasonixSubagentParams) {
    if (rest.validate !== false) {
      const result = ReasonixSubagentFrontmatterSchema.safeParse(frontmatter);
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
    global: _global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Reasonix serves both scopes from `.reasonix/skills/`; the home directory
    // is resolved by the processor through outputRoot in global mode.
    return {
      relativeDirPath: REASONIX_SUBAGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): ReasonixSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    // The `invocation`/`runAs` markers are dropped: generation always re-injects
    // them, so keeping them in the reasonix section would only add noise that
    // is ignored (and silently overridden) on the way back.
    const {
      name,
      description,
      invocation: _invocation,
      runAs: _runAs,
      ...restFields
    } = this.frontmatter;

    const reasonixSection: Record<string, unknown> = {
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      ...(Object.keys(reasonixSection).length > 0 && { reasonix: reasonixSection }),
    };

    return new RulesyncSubagent({
      outputRoot: this.getOutputRoot(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      // The tool-side path is `<name>/SKILL.md`; the rulesync file is a flat
      // `<name>.md`, so the subagent name comes from the parent directory.
      relativeFilePath: `${this.getSubagentName()}.md`,
      validate: true,
    });
  }

  /**
   * Derive the subagent name from this instance's relative file path.
   *
   * The tool-side layout is `<name>/SKILL.md`, so the name is the parent
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
    const reasonixSection = this.filterToolSpecificSection(rulesyncFrontmatter.reasonix ?? {}, [
      "name",
      "description",
    ]);

    // The `invocation`/`runAs` markers are always forced last so a Reasonix
    // subagent profile is emitted regardless of what the source section carries.
    const rawReasonixFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...reasonixSection,
      invocation: REASONIX_SUBAGENT_INVOCATION,
      runAs: REASONIX_SUBAGENT_RUN_AS,
    };

    const result = ReasonixSubagentFrontmatterSchema.safeParse(rawReasonixFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid reasonix subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const reasonixFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, reasonixFrontmatter);

    const paths = this.getSettablePaths({ global });

    // The rulesync subagent is a flat `<name>.md`; Reasonix requires a
    // directory-per-agent Skill layout, so emit `<name>/SKILL.md`.
    const subagentName = basename(
      rulesyncSubagent.getRelativeFilePath(),
      extname(rulesyncSubagent.getRelativeFilePath()),
    );

    return new ReasonixSubagent({
      outputRoot,
      frontmatter: reasonixFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: join(subagentName, SKILL_FILE_NAME),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ReasonixSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "reasonix",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<ReasonixSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatterWithYamlRepair(fileContent, filePath);

    const result = ReasonixSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ReasonixSubagent({
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

  /**
   * Whether the SKILL.md at the given path is a subagent profile.
   *
   * `.reasonix/skills/` is shared with the skills feature: a regular skill and
   * a subagent profile differ only by their frontmatter markers. Only files
   * carrying `runAs: subagent` belong to this feature, so regular skills are
   * neither imported as subagents nor deleted as orphans by the subagents
   * feature. `runAs` alone is checked (not `invocation`) because it is the
   * marker that switches the execution mode; generation always emits both.
   * Unreadable or unparsable files are treated as not owned, erring on the
   * side of leaving foreign files untouched.
   */
  static async isFileOwned({
    outputRoot,
    relativeDirPath,
    relativeFilePath,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    relativeFilePath: string;
  }): Promise<boolean> {
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    try {
      const fileContent = await readFileContent(filePath);
      const { frontmatter } = parseFrontmatterWithYamlRepair(fileContent, filePath);
      return frontmatter["runAs"] === REASONIX_SUBAGENT_RUN_AS;
    } catch {
      return false;
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): ReasonixSubagent {
    return new ReasonixSubagent({
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
