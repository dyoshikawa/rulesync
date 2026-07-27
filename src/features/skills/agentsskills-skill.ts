import { join } from "node:path";

import { z } from "zod/mini";

import { AGENTSMD_SKILLS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const AgentsSkillsSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Optional Agent Skills standard frontmatter. https://agentskills.io/specification
  license: z.optional(z.string()),
  // The spec defines `compatibility` as a free-form string (1–500 chars). The
  // object form is also accepted to stay permissive for existing inputs.
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
});

export type AgentsSkillsSkillFrontmatter = z.infer<typeof AgentsSkillsSkillFrontmatterSchema>;

// Normative limits from the Agent Skills specification.
// https://agentskills.io/specification
const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 1024;
const COMPATIBILITY_MAX_LENGTH = 500;

// "Unicode lowercase alphanumeric characters (`a-z`, `0-9`) and hyphens (`-`)",
// with no leading/trailing hyphen and no consecutive hyphens — all four rules
// expressed as alphanumeric runs joined by single hyphens.
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Render a non-string YAML value as the string the spec requires. Scalars use
 * their natural text form (`1` → `"1"`), containers are JSON-encoded so the
 * original structure stays readable rather than collapsing to `[object Object]`.
 */
function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * The spec types `allowed-tools` as "a space-separated string of tools", so an
 * array from a legacy rulesync input is joined rather than emitted as a YAML
 * sequence. Mirrors `DeepagentsSkill`.
 */
function toAllowedToolsString(value: string | string[]): string {
  return Array.isArray(value) ? value.join(" ") : value;
}

/**
 * The spec types `compatibility` as a free-form string. An object from a legacy
 * rulesync input is flattened to `key: value` pairs instead of being emitted as
 * a YAML mapping, which conformant clients reject.
 */
function toCompatibilityString(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${stringifyValue(entry)}`)
    .join(", ");
}

/**
 * The spec types `metadata` as "a map from string keys to string values", so
 * non-string values (e.g. a YAML number `version: 1`) are stringified.
 */
function toStringMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, stringifyValue(value)]),
  );
}

/**
 * Collect the normative `name` / `description` violations the Agent Skills spec
 * defines. These are reported as warnings rather than errors: import stays
 * lenient per the spec's client-implementation guide, and failing generation
 * outright would break existing skill directories. What must not happen is
 * emitting a skill that conformant clients silently skip without saying so.
 *
 * @see https://agentskills.io/specification
 * @see https://agentskills.io/client-implementation/adding-skills-support
 */
function collectSpecViolations({
  name,
  description,
  dirName,
}: {
  name: string;
  description: string;
  dirName: string;
}): string[] {
  const violations: string[] = [];

  if (name.length === 0) {
    violations.push("`name` is required and must not be empty");
  } else {
    if (name.length > NAME_MAX_LENGTH) {
      violations.push(
        `\`name\` is ${name.length} characters; the Agent Skills spec allows at most ${NAME_MAX_LENGTH}`,
      );
    }
    if (!NAME_PATTERN.test(name)) {
      violations.push(
        `\`name\` "${name}" must contain only lowercase letters, digits and single hyphens, with no leading, trailing or consecutive hyphens`,
      );
    }
    if (name !== dirName) {
      violations.push(
        `\`name\` "${name}" must match its parent directory name "${dirName}"; conformant clients require them to be equal`,
      );
    }
  }

  if (description.length === 0) {
    violations.push(
      "`description` is required and must not be empty; conformant clients skip a skill without one",
    );
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    violations.push(
      `\`description\` is ${description.length} characters; the Agent Skills spec allows at most ${DESCRIPTION_MAX_LENGTH}`,
    );
  }

  return violations;
}

export type AgentsSkillsSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: AgentsSkillsSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents an Agent Skills directory following the open standard.
 * Skills are stored under the .agents/skills directory with SKILL.md files.
 * This is becoming a de facto standard for agent skills across multiple tools.
 */
export class AgentsSkillsSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = AGENTSMD_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: AgentsSkillsSkillParams) {
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

  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    // The Agent Skills standard defines `.agents/skills/` (project) and
    // `~/.agents/skills/` (personal/global). The relative path is the same; the
    // resolution root (cwd vs. home) is supplied via outputRoot by the processor.
    // https://agentskills.io/specification
    return {
      relativeDirPath: AGENTSMD_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): AgentsSkillsSkillFrontmatter {
    const result = AgentsSkillsSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
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

    const result = AgentsSkillsSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const agentsskillsSection = {
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && { compatibility: frontmatter.compatibility }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
      ...(frontmatter["allowed-tools"] !== undefined && {
        "allowed-tools": frontmatter["allowed-tools"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(agentsskillsSection).length > 0 && { agentsskills: agentsskillsSection }),
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
    logger,
  }: ToolSkillFromRulesyncSkillParams): AgentsSkillsSkill {
    const settablePaths = AgentsSkillsSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const agentsskillsSection = rulesyncFrontmatter.agentsskills;
    const dirName = rulesyncSkill.getDirName();
    const skillPath = join(settablePaths.relativeDirPath, dirName, SKILL_FILE_NAME);

    const compatibility =
      agentsskillsSection?.compatibility === undefined
        ? undefined
        : toCompatibilityString(agentsskillsSection.compatibility);
    if (compatibility !== undefined && compatibility.length > COMPATIBILITY_MAX_LENGTH) {
      logger?.warn(
        `${skillPath}: \`compatibility\` is ${compatibility.length} characters; the Agent Skills spec allows at most ${COMPATIBILITY_MAX_LENGTH}`,
      );
    }

    const agentsSkillsFrontmatter: AgentsSkillsSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(agentsskillsSection?.license !== undefined && { license: agentsskillsSection.license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(agentsskillsSection?.metadata !== undefined && {
        metadata: toStringMetadata(agentsskillsSection.metadata),
      }),
      ...(agentsskillsSection?.["allowed-tools"] !== undefined && {
        "allowed-tools": toAllowedToolsString(agentsskillsSection["allowed-tools"]),
      }),
    };

    for (const violation of collectSpecViolations({
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      dirName,
    })) {
      logger?.warn(`${skillPath}: ${violation}`);
    }

    return new this({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: agentsSkillsFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("agentsskills");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<AgentsSkillsSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: AgentsSkillsSkill.getSettablePaths,
    });

    const result = AgentsSkillsSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new this({
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
  }: ToolSkillForDeletionParams): AgentsSkillsSkill {
    const settablePaths = AgentsSkillsSkill.getSettablePaths({ global });
    return new this({
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
