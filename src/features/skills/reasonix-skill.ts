import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  REASONIX_MANUAL_INVOCATION,
  REASONIX_SKILLS_DIR_PATH,
  REASONIX_SUBAGENT_RUN_AS,
} from "../../constants/reasonix-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatterWithYamlRepair } from "../../utils/frontmatter.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveDisableModelInvocation, resolveUserInvocable } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// Reasonix skills use the Anthropic Agent Skills format: a `<name>/SKILL.md`
// directory whose YAML frontmatter carries `name`/`description` (the same shape
// the canonical rulesync skill adapter emits). Besides that pair, rulesync
// models the invocation flags. The CLI v2 line (since v2.28.0) reads
// `disable-model-invocation` (the model may neither list nor call the skill)
// and `user-invocable` (`false` hides it from the slash surface) natively. The
// v1 line reads neither, only `invocation: manual`, which keeps the skill out
// of the model's catalog while it stays callable by name. So a
// `disable-model-invocation: true` is written with `invocation: manual` beside
// it, and v2 reads the two independently. Because the two are not the same
// switch (`manual` only hides; the flag also refuses model calls), an
// `invocation` authored in the `reasonix` section is written verbatim and an
// imported one is kept there rather than folded into the flag — except that a
// `disable-model-invocation: true` always writes `manual`, since v1 has no
// other way to honour it. v2 parses the flags leniently (`yes`/`no`,
// `on`/`off`, `1`/`0`, case-insensitive), so the schema accepts any value and
// the adapter reads those spellings. Like `parseInvocationFlags`, an
// unreadable `disable-model-invocation` fails closed (read as `true`), while an
// unreadable `user-invocable` is ignored. `model`/`effort`/`allowed-tools`/
// `read-only` take effect only on a `runAs: subagent` profile, which the
// subagents feature owns, so they are not modeled here. The schema is loose,
// so an imported file carrying extra keys still parses.
// https://github.com/esengine/DeepSeek-Reasonix/blob/v2.31.0/internal/ext/skill/invocation_flags.go
// https://github.com/esengine/DeepSeek-Reasonix/blob/v1.39.8/internal/skill/skill.go
export const ReasonixSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  invocation: z.optional(z.unknown()),
  "disable-model-invocation": z.optional(z.unknown()),
  "user-invocable": z.optional(z.unknown()),
});

export type ReasonixSkillFrontmatter = z.infer<typeof ReasonixSkillFrontmatterSchema>;

export type ReasonixSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ReasonixSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a DeepSeek-Reasonix skill directory.
 *
 * Reasonix discovers directory-layout skills (`<name>/SKILL.md`) under
 * `.reasonix/skills/` (project) and `~/.reasonix/skills/` (global); the global
 * scope is served by the processor supplying the home directory as outputRoot.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
 */
export class ReasonixSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = REASONIX_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ReasonixSkillParams) {
    super({
      outputRoot,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter },
      },
      otherFiles,
      global,
    });

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths({
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: REASONIX_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): ReasonixSkillFrontmatter {
    return ReasonixSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (this.mainFile === undefined) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }
    const result = ReasonixSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    // Into the `reasonix` section, not the root: the root-level flags are
    // shared defaults for every tool that honours them. `invocation` is kept
    // as authored, except the `manual` that generate writes beside
    // `disable-model-invocation: true`: it follows from the flag, and keeping
    // it would pin the skill hidden after the flag is turned off.
    const disableModelInvocation = parseDisableModelInvocation(
      frontmatter["disable-model-invocation"],
    );
    const userInvocable = parseReasonixBool(frontmatter["user-invocable"]);
    const invocation =
      typeof frontmatter.invocation === "string" &&
      !(disableModelInvocation === true && isManualInvocation(frontmatter.invocation))
        ? frontmatter.invocation
        : undefined;
    const reasonixSection = {
      ...(invocation !== undefined && { invocation }),
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(reasonixSection).length > 0 && { reasonix: reasonixSection }),
    };

    return new RulesyncSkill({
      outputRoot: this.outputRoot,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global,
    });
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): ReasonixSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.reasonix,
    });
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.reasonix,
    });

    // A disabled model invocation always writes `manual`: v1 reads nothing
    // else, so an authored `auto` would put the skill back in its catalog.
    const invocation =
      disableModelInvocation === true
        ? REASONIX_MANUAL_INVOCATION
        : rulesyncFrontmatter.reasonix?.invocation;

    const reasonixFrontmatter: ReasonixSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(invocation !== undefined && { invocation }),
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };

    const settablePaths = ReasonixSkill.getSettablePaths({ global });

    return new ReasonixSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: reasonixFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const targets = frontmatter.targets;
    return targets.includes("*") || targets.includes("reasonix");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ReasonixSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ReasonixSkill.getSettablePaths,
    });

    const result = ReasonixSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new ReasonixSkill({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global,
    });
  }

  /**
   * Whether the skill directory belongs to the skills feature.
   *
   * `.reasonix/skills/` is shared with the subagents feature: a directory whose
   * SKILL.md declares `runAs: subagent` is a subagent profile, not a regular
   * skill, so it must be neither imported as a skill nor deleted as an orphan
   * skill. Directories without a readable/parsable SKILL.md keep the default
   * skills-feature ownership, matching the previous behavior for such dirs.
   */
  static async isDirOwned({
    outputRoot,
    relativeDirPath,
    dirName,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
    // Accepted for interface parity with tools whose ownership hook consults
    // `.rulesync/` sources; Reasonix decides ownership purely from the
    // generated SKILL.md, so the value is unused.
    inputRoots: readonly string[];
  }): Promise<boolean> {
    const skillFilePath = join(outputRoot, relativeDirPath, dirName, SKILL_FILE_NAME);
    try {
      const fileContent = await readFileContent(skillFilePath);
      const { frontmatter } = parseFrontmatterWithYamlRepair(fileContent, skillFilePath, {
        quiet: true,
      });
      return frontmatter["runAs"] !== REASONIX_SUBAGENT_RUN_AS;
    } catch {
      return true;
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): ReasonixSkill {
    return new ReasonixSkill({
      outputRoot,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}

/**
 * Whether an `invocation` value is Reasonix's `manual`, which it compares after
 * trimming and case-folding (`parseInvocation`).
 */
function isManualInvocation(invocation: string): boolean {
  return invocation.trim().toLowerCase() === REASONIX_MANUAL_INVOCATION;
}

/**
 * Reads `disable-model-invocation` the way Reasonix v2 does: fail closed, so a
 * present, non-blank value it cannot read as a boolean restricts the skill.
 */
function parseDisableModelInvocation(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return parseReasonixBool(value) ?? true;
}

/**
 * Reads an invocation flag the way Reasonix v2 does (`parseStrictBool`): a
 * boolean, or a `true`/`yes`/`1`/`on` / `false`/`no`/`0`/`off` spelling
 * compared after trimming and case-folding. Anything else is `undefined`.
 */
function parseReasonixBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}
