import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, SkillFile } from "./rulesync-skill.js";
import { ToolSkill } from "./tool-skill.js";

export const SimulatedSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type SimulatedSkillFrontmatter = z.infer<typeof SimulatedSkillFrontmatterSchema>;

export type SimulatedSkillParams = {
  outputRoot?: string;
  relativeDirPath: string;
  dirName: string;
  frontmatter: SimulatedSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
};

/**
 * Abstract base class for simulated skill formats.
 *
 * Simulated skills are used for tools that don't have native skill support
 * (e.g., AGENTS.md). The processor recognizes them by this class: they are
 * project mode only and are never converted back to RulesyncSkill.
 */
export abstract class SimulatedSkill extends ToolSkill {
  private readonly frontmatter: SimulatedSkillFrontmatter;

  constructor({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
  }: SimulatedSkillParams) {
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
      global: false, // Simulated skills are project mode only
    });

    if (validate) {
      const result = SimulatedSkillFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(relativeDirPath, dirName)}: ${formatError(result.error)}`,
        );
      }
    }

    this.frontmatter = frontmatter;
  }

  getFrontmatter(): SimulatedSkillFrontmatter {
    return this.frontmatter;
  }

  toRulesyncSkill(): RulesyncSkill {
    throw new Error("Not implemented because it is a SIMULATED skill.");
  }

  validate(): ValidationResult {
    const result = SimulatedSkillFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }
  }
}
