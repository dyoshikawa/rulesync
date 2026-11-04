import { z } from "zod/mini";

import { COMMANDCODE_SKILLS_DIR_PATH } from "../../constants/commandcode-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  resolveCompatibility,
  resolveDisableModelInvocation,
  resolveLicense,
  resolveMetadata,
  resolveUserInvocable,
} from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// Command Code skill frontmatter: `name` and `description` as in the Agent
// Skills spec. The Agent Skills packaging trio and the two invocation gates
// are typed because they also have root-level rulesync defaults; the other
// documented optional keys (`allowed-tools`, `disallowed-tools`,
// `argument-hint`, `when_to_use`, `arguments`, `model`, `effort`) and any
// newer key pass through untouched.
// @see https://commandcode.ai/docs/skills
const CommandcodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
  "disable-model-invocation": z.optional(z.boolean()),
  "user-invocable": z.optional(z.boolean()),
});

export type CommandcodeSkillFrontmatter = z.infer<typeof CommandcodeSkillFrontmatterSchema>;

export type CommandcodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CommandcodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Command Code skill directory.
 *
 * Command Code discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.commandcode/skills/` (project scope) and
 * `~/.commandcode/skills/` (user scope). The frontmatter requires `name`
 * (matching the directory name) and `description`; supporting files next to
 * `SKILL.md` are carried along.
 *
 * @see https://commandcode.ai/docs/skills
 */
export class CommandcodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = COMMANDCODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CommandcodeSkillParams) {
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.commandcode/skills/
    // - Global mode: {getHomeDirectory()}/.commandcode/skills/
    return {
      relativeDirPath: COMMANDCODE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): CommandcodeSkillFrontmatter {
    const result = CommandcodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatterAndDirName(CommandcodeSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    // Everything beyond `name` / `description` (the documented optional keys
    // and any key a hand-written SKILL.md carries) is lifted into the
    // `commandcode` section so it survives the round-trip (mirrors roo-skill.ts).
    const { name, description, ...commandcodeSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(commandcodeSection).length > 0 && { commandcode: commandcodeSection }),
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): CommandcodeSkill {
    const settablePaths = CommandcodeSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `commandcode` section carries Command Code-specific frontmatter; canonical
    // name/description always win over a stray same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...commandcodeSection
    } = rulesyncFrontmatter.commandcode ?? {};
    // The Agent Skills packaging fields and the two invocation gates fall
    // back to the root-level rulesync value when the section omits them
    // (mirrors `CrushSkill`). Every resolver prefers a defined section value,
    // so re-applying the resolved values over the spread never discards one.
    const license = resolveLicense({
      rootFrontmatter: rulesyncFrontmatter,
      section: commandcodeSection,
    });
    const compatibility = resolveCompatibility({
      rootFrontmatter: rulesyncFrontmatter,
      section: commandcodeSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: commandcodeSection,
    });
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: commandcodeSection,
    });
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: commandcodeSection,
    });
    const commandcodeFrontmatter: CommandcodeSkillFrontmatter = {
      ...commandcodeSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(license !== undefined && { license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(metadata !== undefined && { metadata }),
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };

    return new CommandcodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: commandcodeFrontmatter.name,
      frontmatter: commandcodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget = "commandcode";

  static async fromDir(params: ToolSkillFromDirParams): Promise<CommandcodeSkill> {
    return new CommandcodeSkill(
      await this.loadStandardSkillParamsMatchingDirName({
        params,
        schema: CommandcodeSkillFrontmatterSchema,
      }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): CommandcodeSkill {
    return new CommandcodeSkill(this.forDeletionParams(params));
  }
}
