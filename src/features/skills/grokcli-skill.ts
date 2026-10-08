import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { GROKCLI_SKILLS_DIR_PATH } from "../../constants/grokcli-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
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

const GrokcliSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Invocation control Grok honours: a skill with `user-invocable: false` is
  // hidden from the skill tool, and `disable-model-invocation: true` stops the
  // model reaching for it on its own. Both are canonical fields other adapters
  // already emit, so dropping them here made the flags silently target-specific.
  // https://docs.x.ai/build/features/skills-plugins-marketplaces
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
  // Path-gated (conditional) skill: gitignore globs that keep the skill out of
  // the listing until a tool touches a matching file. Grok's parser accepts a
  // YAML list or a comma-separated string, so both shapes pass through as-is.
  // https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-tools/src/implementations/skills/discovery.rs
  paths: z.optional(z.union([z.string(), z.array(z.string())])),
  // The other optional fields Grok's skill parser reads (`when-to-use`, also
  // spelled `when_to_use`; `allowed-tools` as a list or a comma- or
  // space-separated string; `argument-hint`, `model`, `effort`) plus the Agent
  // Skills packaging trio. Grok promotes `metadata.author` and
  // `metadata.short-description` in its UI. Any newer key (e.g. the `origin`
  // telemetry slug) passes through the loose schema untouched.
  // https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md
  "when-to-use": z.optional(z.string()),
  when_to_use: z.optional(z.string()),
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  "argument-hint": z.optional(z.string()),
  model: z.optional(z.string()),
  effort: z.optional(z.string()),
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
});

export type GrokcliSkillFrontmatter = z.infer<typeof GrokcliSkillFrontmatterSchema>;

export type GrokcliSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: GrokcliSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Grok Build skill directory.
 *
 * Grok Build discovers skills under `./.grok/skills/` (project) and
 * `~/.grok/skills/` (global), each a directory containing a `SKILL.md` with
 * `name`/`description` frontmatter (verified via `grok inspect`). The format is
 * Claude-compatible, so only `name` and `description` are required; every
 * other key round-trips through the `grokcli` section of the rulesync skill.
 * @see https://docs.x.ai/build/features/skills-plugins-marketplaces
 */
export class GrokcliSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = GROKCLI_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: GrokcliSkillParams) {
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
    // Grok Build skills use the same relative path for both project and global
    // modes; the location differs based on outputRoot (./.grok/skills vs
    // ~/.grok/skills).
    //
    // Grok also discovers skills from `~/.agents/skills/` (Agents.md
    // compatibility) and from extra `[skills] paths` entries in
    // `~/.grok/config.toml`. rulesync intentionally emits only the canonical
    // `.grok/skills/` root, matching how the other native-skill tools target a
    // single canonical directory.
    return {
      relativeDirPath: GROKCLI_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): GrokcliSkillFrontmatter {
    return GrokcliSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = GrokcliSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // Everything beyond `name` / `description` goes into the `grokcli` section,
    // not the root: the root values are shared defaults for every tool that
    // honours the field, so importing one tool's setting there would apply it
    // to Claude Code, Cursor, Zed and the rest. Keys are kept as spelled
    // (`when_to_use` stays `when_to_use`), since Grok reads both spellings.
    const { name, description, ...grokcliSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      ...(Object.keys(grokcliSection).length > 0 && { grokcli: grokcliSection }),
      targets: ["*"],
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
  }: ToolSkillFromRulesyncSkillParams): GrokcliSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const settablePaths = GrokcliSkill.getSettablePaths({ global });

    // The `grokcli` section carries Grok-specific frontmatter verbatim; the
    // canonical name/description always win over a stray same-named key in it.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...grokcliSection
    } = rulesyncFrontmatter.grokcli ?? {};
    // The Agent Skills packaging fields and the two invocation gates fall back
    // to the root-level rulesync value when the section omits them. Every
    // resolver prefers a defined section value, so re-applying the resolved
    // values over the spread never discards one.
    const license = resolveLicense({
      rootFrontmatter: rulesyncFrontmatter,
      section: grokcliSection,
    });
    const compatibility = resolveCompatibility({
      rootFrontmatter: rulesyncFrontmatter,
      section: grokcliSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: grokcliSection,
    });
    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: grokcliSection,
    });
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: grokcliSection,
    });

    const grokcliFrontmatter: GrokcliSkillFrontmatter = {
      ...grokcliSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(license !== undefined && { license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(metadata !== undefined && { metadata }),
      ...(resolvedUserInvocable !== undefined && { "user-invocable": resolvedUserInvocable }),
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
    };

    return new GrokcliSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: grokcliFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("grokcli");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<GrokcliSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: GrokcliSkill.getSettablePaths,
    });

    const result = GrokcliSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new GrokcliSkill({
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
  }: ToolSkillForDeletionParams): GrokcliSkill {
    return new GrokcliSkill({
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
