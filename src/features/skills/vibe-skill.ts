import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import {
  RulesyncSkill,
  RulesyncSkillFrontmatter,
  RulesyncSkillFrontmatterInput,
  SkillFile,
} from "./rulesync-skill.js";
import {
  resolveCompatibility,
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

export const VibeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
  "user-invocable": z.optional(z.boolean()),
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
});

export type VibeSkillFrontmatter = z.infer<typeof VibeSkillFrontmatterSchema>;

export type VibeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: VibeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Build the Vibe frontmatter from a rulesync skill frontmatter, preferring the
 * dedicated `vibe` section over the shared root-level fields.
 */
function buildVibeFrontmatter(rulesyncFrontmatter: RulesyncSkillFrontmatter): VibeSkillFrontmatter {
  const vibeSection = rulesyncFrontmatter.vibe;

  const license = resolveLicense({ rootFrontmatter: rulesyncFrontmatter, section: vibeSection });
  const compatibility = resolveCompatibility({
    rootFrontmatter: rulesyncFrontmatter,
    section: vibeSection,
  });
  const metadata = resolveMetadata({ rootFrontmatter: rulesyncFrontmatter, section: vibeSection });
  const resolvedUserInvocable = resolveUserInvocable({
    rootFrontmatter: rulesyncFrontmatter,
    section: vibeSection,
  });

  return {
    name: rulesyncFrontmatter.name,
    description: rulesyncFrontmatter.description,
    ...(license !== undefined && { license }),
    ...(compatibility !== undefined && { compatibility }),
    ...(metadata !== undefined && { metadata }),
    ...(resolvedUserInvocable !== undefined && {
      "user-invocable": resolvedUserInvocable,
    }),
    ...(vibeSection?.["allowed-tools"] !== undefined && {
      "allowed-tools": vibeSection["allowed-tools"],
    }),
  };
}

export class VibeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = VibeSkill.getSettablePaths().relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: VibeSkillParams) {
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
    // Vibe's `user_skills_dirs` returns both `~/.vibe/skills` and
    // `~/.agents/skills`, and its project discovery covers the matching pair, so
    // the shared root is a discovery root at either scope. Import-only, like
    // the same root on `kimi-code`: rulesync never writes there for this target,
    // so a skill another tool put in the shared tree must not become an orphan
    // deletion candidate — least of all under the user's home directory.
    return {
      relativeDirPath: join(".vibe", "skills"),
      importOnlySkillRoots: [join(".agents", "skills")],
    };
  }

  getFrontmatter(): VibeSkillFrontmatter {
    return VibeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }

    const result = VibeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const vibeSection = {
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && { compatibility: frontmatter.compatibility }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
      ...(frontmatter["user-invocable"] !== undefined && {
        "user-invocable": frontmatter["user-invocable"],
      }),
      ...(frontmatter["allowed-tools"] !== undefined && {
        "allowed-tools": frontmatter["allowed-tools"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(vibeSection).length > 0 && { vibe: vibeSection }),
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
  }: ToolSkillFromRulesyncSkillParams): VibeSkill {
    const settablePaths = VibeSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const vibeFrontmatter = buildVibeFrontmatter(rulesyncFrontmatter);

    return new VibeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: vibeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("vibe");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<VibeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: VibeSkill.getSettablePaths,
    });

    const result = VibeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new VibeSkill({
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

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): VibeSkill {
    const settablePaths = VibeSkill.getSettablePaths({ global });
    return new VibeSkill({
      outputRoot,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
