import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiDir } from "../../types/ai-dir.js";
import { DirFeatureProcessor } from "../../types/dir-feature-processor.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkill } from "./tool-skill.js";

const skillsProcessorToolTargets: ToolTarget[] = ["claudecode"];
export const skillsProcessorToolTargetsGlobal: ToolTarget[] = ["claudecode"];
export const SkillsProcessorToolTargetSchema = z.enum(skillsProcessorToolTargets);

export type SkillsProcessorToolTarget = z.infer<typeof SkillsProcessorToolTargetSchema>;

export class SkillsProcessor extends DirFeatureProcessor {
  private readonly toolTarget: SkillsProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
  }: { baseDir?: string; toolTarget: SkillsProcessorToolTarget; global?: boolean }) {
    super({ baseDir });
    const result = SkillsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SkillsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async convertRulesyncDirsToToolDirs(rulesyncDirs: AiDir[]): Promise<AiDir[]> {
    const rulesyncSkills = rulesyncDirs.filter(
      (dir): dir is RulesyncSkill => dir instanceof RulesyncSkill,
    );

    const toolSkills = rulesyncSkills
      .map((rulesyncSkill) => {
        switch (this.toolTarget) {
          case "claudecode":
            if (!ClaudecodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)) {
              return null;
            }
            return ClaudecodeSkill.fromRulesyncSkill({
              rulesyncSkill: rulesyncSkill,
              global: this.global,
            });
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      })
      .filter((skill): skill is ClaudecodeSkill => skill !== null);

    return toolSkills;
  }

  async convertToolDirsToRulesyncDirs(toolDirs: AiDir[]): Promise<AiDir[]> {
    const toolSkills = toolDirs.filter((dir): dir is ToolSkill => dir instanceof ToolSkill);

    const rulesyncSkills = toolSkills.map((toolSkill) => {
      return toolSkill.toRulesyncSkill();
    });

    return rulesyncSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load and parse rulesync skill directories from .rulesync/skills/ directory
   */
  async loadRulesyncDirs(): Promise<AiDir[]> {
    const paths = RulesyncSkill.getSettablePaths();
    const rulesyncSkillsDirPath = join(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs(join(rulesyncSkillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));

    const results = await Promise.allSettled(
      dirNames.map((dirName) =>
        RulesyncSkill.fromDir({ baseDir: this.baseDir, dirName, global: this.global }),
      ),
    );

    const rulesyncSkills: RulesyncSkill[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        rulesyncSkills.push(result.value);
      }
    }

    logger.info(`Successfully loaded ${rulesyncSkills.length} rulesync skills`);
    return rulesyncSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load tool-specific skill configurations and parse them into ToolSkill instances
   */
  async loadToolDirs(): Promise<AiDir[]> {
    switch (this.toolTarget) {
      case "claudecode":
        return await this.loadClaudecodeSkills();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  async loadToolDirsToDelete(): Promise<AiDir[]> {
    return this.loadToolDirs();
  }

  /**
   * Load Claude Code skill configurations from .claude/skills/ directory
   */
  private async loadClaudecodeSkills(): Promise<ToolSkill[]> {
    const paths = ClaudecodeSkill.getSettablePaths({ global: this.global });
    const skillsDirPath = join(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs(join(skillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));

    const toolSkills = (
      await Promise.allSettled(
        dirNames.map((dirName) =>
          ClaudecodeSkill.fromDir({
            baseDir: this.baseDir,
            dirName,
            global: this.global,
          }),
        ),
      )
    )
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    logger.info(`Successfully loaded ${toolSkills.length} ${paths.relativeDirPath} skills`);
    return toolSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return skillsProcessorToolTargetsGlobal;
    }
    return skillsProcessorToolTargets;
  }
}
