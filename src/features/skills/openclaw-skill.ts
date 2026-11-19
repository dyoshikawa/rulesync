import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  OPENCLAW_GLOBAL_SKILLS_DIR_PATH,
  OPENCLAW_PROJECT_SKILLS_DIR_PATH,
} from "../../constants/openclaw-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  resolveDisableModelInvocation,
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

// OpenClaw reads `name` and `description` (required) plus the optional
// `homepage`, `user-invocable` (default true: expose as a slash command),
// `disable-model-invocation` (default false), `command-dispatch` /
// `command-tool` / `command-arg-mode` (dispatch the slash command straight to a
// tool) and a `metadata.openclaw` gating block (`os`, `requires.*`, `always`,
// `primaryEnv`, `install`, `skillKey`, ...). The schema stays loose so a
// hand-written SKILL.md carrying other keys still parses and round-trips.
// @see https://docs.openclaw.ai/tools/skills
const OpenclawSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  homepage: z.optional(z.string()),
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
  "command-dispatch": z.optional(z.string()),
  "command-tool": z.optional(z.string()),
  "command-arg-mode": z.optional(z.string()),
  metadata: z.optional(z.looseObject({})),
});

export type OpenclawSkillFrontmatter = z.infer<typeof OpenclawSkillFrontmatterSchema>;

export type OpenclawSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: OpenclawSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents an OpenClaw skill directory.
 *
 * Project mode writes the execution folder's `.agents/skills/<name>/SKILL.md`,
 * which OpenClaw loads when a session runs from that folder (the same mechanism
 * that loads the folder's `AGENTS.md`). Global mode writes the managed/local
 * `~/.openclaw/skills/<name>/SKILL.md` root, visible to every agent sharing the
 * default state directory. The execution folder's `skills/` and the personal
 * `~/.agents/skills` roots are left alone (see `openclaw-paths.ts`).
 *
 * Every key beyond `name`/`description` is carried in the `openclaw` section of
 * the rulesync skill; the two invocation flags and `metadata` fall back to the
 * shared root-level defaults when the section omits them.
 *
 * @see https://docs.openclaw.ai/tools/skills
 */
export class OpenclawSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = OPENCLAW_PROJECT_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: OpenclawSkillParams) {
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
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode.
    return {
      relativeDirPath: global ? OPENCLAW_GLOBAL_SKILLS_DIR_PATH : OPENCLAW_PROJECT_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): OpenclawSkillFrontmatter {
    return OpenclawSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatter(OpenclawSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    // Into the `openclaw` section, not the root: the root-level flags and
    // `metadata` are shared defaults for every tool that honours them, so
    // importing one tool's setting there would apply it to the rest.
    const { name, description, ...section } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(section).length > 0 && { openclaw: section }),
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): OpenclawSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...section
    } = rulesyncFrontmatter.openclaw ?? {};
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section,
    });
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section,
    });

    const frontmatter: OpenclawSkillFrontmatter = {
      ...section,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(metadata !== undefined && { metadata }),
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };

    return new OpenclawSkill({
      outputRoot,
      relativeDirPath: OpenclawSkill.getSettablePaths({ global }).relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget = "openclaw";

  static async fromDir(params: ToolSkillFromDirParams): Promise<OpenclawSkill> {
    return new OpenclawSkill(
      await this.loadStandardSkillParams({ params, schema: OpenclawSkillFrontmatterSchema }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): OpenclawSkill {
    return new OpenclawSkill(this.forDeletionParams(params));
  }
}
