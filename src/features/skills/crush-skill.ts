import { join } from "node:path";

import { z } from "zod/mini";

import { CRUSH_SKILLS_GLOBAL_DIR, CRUSH_SKILLS_PROJECT_DIR } from "../../constants/crush-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { toCompatibilityString, toStringMetadata } from "./agentsskills-skill.js";
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

const CrushSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Crush's `Skill` struct (internal/skills/skills.go) fields beyond
  // name/description: both invocation gates, plus the Agent Skills packaging
  // trio. Crush's Go struct types `compatibility` as a bare string and
  // `metadata` as `map[string]string`, and its `yaml.Unmarshal` fails the
  // whole document on a type mismatch, so this schema stays lenient (it also
  // accepts the legacy object `compatibility` and non-string `metadata`
  // values every other adapter resolves via `resolveCompatibility`/
  // `resolveMetadata`) purely so a loosely-shaped root default still parses;
  // `fromRulesyncSkill` below normalizes both fields to the shapes Crush's
  // parser actually requires — reusing `toCompatibilityString`/
  // `toStringMetadata` from `agentsskills-skill.ts` (also shared by
  // `HermesagentSkill`) rather than a second, divergent implementation —
  // before a `CrushSkill` is ever constructed.
  // https://github.com/charmbracelet/crush/blob/main/internal/skills/skills.go
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
});

export type CrushSkillFrontmatter = z.infer<typeof CrushSkillFrontmatterSchema>;

export type CrushSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CrushSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Crush Agent Skill directory.
 *
 * Crush auto-discovers Agent Skills (`SKILL.md` per directory) from
 * `.crush/skills/` at project scope and `~/.config/crush/skills/` (or
 * `$CRUSH_SKILLS_DIR`) at global scope. Unless `$CRUSH_SKILLS_DIR` is set,
 * Crush also scans several shared directories it does not own (globally
 * `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.claude/skills/`;
 * per-project `.agents/skills/`, `.claude/skills/`, `.cursor/skills/`, also
 * checked at a git worktree's common root); this class writes only to the
 * Crush-specific path above, leaving those shared roots to their own targets.
 *
 * Crush's `UserInvocable` field is a non-pointer Go `bool`, so an omitted
 * `user-invocable` (at both the root and the `crush:` section) resolves to
 * `false`: the skill stays reachable by the model but is hidden from Crush's
 * command palette. See `FromSkillCatalog` in `internal/commands/commands.go`.
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
 */
export class CrushSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = CRUSH_SKILLS_PROJECT_DIR,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CrushSkillParams) {
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: global ? CRUSH_SKILLS_GLOBAL_DIR : CRUSH_SKILLS_PROJECT_DIR,
    };
  }

  getFrontmatter(): CrushSkillFrontmatter {
    return CrushSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = CrushSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const crushSection = {
      ...(frontmatter["user-invocable"] !== undefined && {
        "user-invocable": frontmatter["user-invocable"],
      }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && {
        compatibility: frontmatter.compatibility,
      }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(crushSection).length > 0 && { crush: crushSection }),
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
  }: ToolSkillFromRulesyncSkillParams): CrushSkill {
    const settablePaths = CrushSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const crushSection = rulesyncFrontmatter.crush;

    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: crushSection,
    });
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: crushSection,
    });
    const license = resolveLicense({
      rootFrontmatter: rulesyncFrontmatter,
      section: crushSection,
    });
    const compatibility = resolveCompatibility({
      rootFrontmatter: rulesyncFrontmatter,
      section: crushSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: crushSection,
    });

    const compatibilityString =
      compatibility === undefined ? undefined : toCompatibilityString(compatibility);

    const crushFrontmatter: CrushSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(resolvedUserInvocable !== undefined && { "user-invocable": resolvedUserInvocable }),
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
      ...(license !== undefined && { license }),
      ...(compatibilityString !== undefined &&
        compatibilityString.length > 0 && { compatibility: compatibilityString }),
      ...(metadata !== undefined && { metadata: toStringMetadata(metadata) }),
    };

    return new CrushSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: crushFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("crush");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CrushSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CrushSkill.getSettablePaths,
    });

    const result = CrushSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CrushSkill({
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
  }: ToolSkillForDeletionParams): CrushSkill {
    const settablePaths = CrushSkill.getSettablePaths({ global });
    return new CrushSkill({
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
