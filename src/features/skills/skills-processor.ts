import { basename, join } from "node:path";
import { z } from "zod/mini";

import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiDir } from "../../types/ai-dir.js";
import { DirFeatureProcessor } from "../../types/dir-feature-processor.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { directoryExists, findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdSkill } from "./agentsmd-skill.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { AntigravitySkill } from "./antigravity-skill.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { CodexCliSkill } from "./codexcli-skill.js";
import { CopilotSkill } from "./copilot-skill.js";
import { CursorSkill } from "./cursor-skill.js";
import { FactorydroidSkill } from "./factorydroid-skill.js";
import { GeminiCliSkill } from "./geminicli-skill.js";
import { KiloSkill } from "./kilo-skill.js";
import { KiroSkill } from "./kiro-skill.js";
import { OpenCodeSkill } from "./opencode-skill.js";
import { ReplitSkill } from "./replit-skill.js";
import { RooSkill } from "./roo-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill } from "./simulated-skill.js";
import { getLocalSkillDirNames } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Factory entry for each tool skill class.
 * Stores the class reference and metadata for a tool.
 */
type ToolSkillFactory = {
  class: {
    isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean;
    fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): ToolSkill;
    fromDir(params: ToolSkillFromDirParams): Promise<ToolSkill>;
    forDeletion(params: ToolSkillForDeletionParams): ToolSkill;
    getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths;
  };
  meta: {
    /** Whether the tool supports project (workspace-level) skills */
    supportsProject: boolean;
    /** Whether the tool supports simulated skills (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) skills */
    supportsGlobal: boolean;
  };
};

/**
 * Supported tool targets for SkillsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
const skillsProcessorToolTargetTuple = [
  "agentsmd",
  "agentsskills",
  "antigravity",
  "claudecode",
  "claudecode-legacy",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "kilo",
  "kiro",
  "opencode",
  "replit",
  "roo",
] as const;

export type SkillsProcessorToolTarget = (typeof skillsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const SkillsProcessorToolTargetSchema = z.enum(skillsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their skill factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolSkillFactories = new Map<SkillsProcessorToolTarget, ToolSkillFactory>([
  [
    "agentsmd",
    {
      class: AgentsmdSkill,
      meta: { supportsProject: true, supportsSimulated: true, supportsGlobal: false },
    },
  ],
  [
    "agentsskills",
    {
      class: AgentsSkillsSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "antigravity",
    {
      class: AntigravitySkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "codexcli",
    {
      class: CodexCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "copilot",
    {
      class: CopilotSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "cursor",
    {
      class: CursorSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidSkill,
      meta: { supportsProject: true, supportsSimulated: true, supportsGlobal: true },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "kilo",
    {
      class: KiloSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "kiro",
    {
      class: KiroSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
  [
    "replit",
    {
      class: ReplitSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "roo",
    {
      class: RooSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true },
    },
  ],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: SkillsProcessorToolTarget) => ToolSkillFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolSkillFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolSkillFactories.keys()];

const skillsProcessorToolTargetsProject: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsProject ?? true;
});

export const skillsProcessorToolTargetsSimulated: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolSkillFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  },
);

export const skillsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

export class SkillsProcessor extends DirFeatureProcessor {
  private readonly toolTarget: SkillsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
  }) {
    super({ baseDir, dryRun });
    const result = SkillsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SkillsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncDirsToToolDirs(rulesyncDirs: AiDir[]): Promise<AiDir[]> {
    const rulesyncSkills = rulesyncDirs.filter(
      (dir): dir is RulesyncSkill => dir instanceof RulesyncSkill,
    );

    const factory = this.getFactory(this.toolTarget);

    const toolSkills = rulesyncSkills
      .map((rulesyncSkill) => {
        if (!factory.class.isTargetedByRulesyncSkill(rulesyncSkill)) {
          return null;
        }
        return factory.class.fromRulesyncSkill({
          rulesyncSkill: rulesyncSkill,
          global: this.global,
        });
      })
      .filter((skill): skill is ToolSkill => skill !== null);

    return toolSkills;
  }

  async convertToolDirsToRulesyncDirs(toolDirs: AiDir[]): Promise<AiDir[]> {
    const toolSkills = toolDirs.filter((dir): dir is ToolSkill => dir instanceof ToolSkill);

    const rulesyncSkills: RulesyncSkill[] = [];
    for (const toolSkill of toolSkills) {
      // Skip simulated skills as they cannot be converted back
      if (toolSkill instanceof SimulatedSkill) {
        logger.debug(`Skipping simulated skill conversion: ${toolSkill.getDirPath()}`);
        continue;
      }
      rulesyncSkills.push(toolSkill.toRulesyncSkill());
    }

    return rulesyncSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load and parse rulesync skill directories from .rulesync/skills/ directory
   * and also from .rulesync/skills/.curated/ for remote skills.
   * Local skills take precedence over curated skills with the same name.
   */
  async loadRulesyncDirs(): Promise<AiDir[]> {
    // Load local skills (directly under .rulesync/skills/)
    const localDirNames = [...(await getLocalSkillDirNames(this.baseDir))];

    const localSkills = await Promise.all(
      localDirNames.map((dirName) =>
        RulesyncSkill.fromDir({ baseDir: this.baseDir, dirName, global: this.global }),
      ),
    );

    const localSkillNames = new Set(localDirNames);

    // Load curated (remote) skills from .curated/ subdirectory
    const curatedDirPath = join(this.baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    let curatedSkills: RulesyncSkill[] = [];

    if (await directoryExists(curatedDirPath)) {
      const curatedDirPaths = await findFilesByGlobs(join(curatedDirPath, "*"), { type: "dir" });
      const curatedDirNames = curatedDirPaths.map((path) => basename(path));

      // Filter out curated skills that conflict with local skills (local wins)
      const nonConflicting = curatedDirNames.filter((name) => {
        if (localSkillNames.has(name)) {
          logger.debug(`Skipping curated skill "${name}": local skill takes precedence.`);
          return false;
        }
        return true;
      });

      const curatedRelativeDirPath = RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH;
      curatedSkills = await Promise.all(
        nonConflicting.map((dirName) =>
          RulesyncSkill.fromDir({
            baseDir: this.baseDir,
            relativeDirPath: curatedRelativeDirPath,
            dirName,
            global: this.global,
          }),
        ),
      );
    }

    const allSkills = [...localSkills, ...curatedSkills];
    logger.debug(
      `Successfully loaded ${allSkills.length} rulesync skills (${localSkills.length} local, ${curatedSkills.length} curated)`,
    );
    return allSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load tool-specific skill configurations and parse them into ToolSkill instances
   */
  async loadToolDirs(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });

    const skillsDirPath = join(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs(join(skillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));

    const toolSkills = await Promise.all(
      dirNames.map((dirName) =>
        factory.class.fromDir({
          baseDir: this.baseDir,
          dirName,
          global: this.global,
        }),
      ),
    );

    logger.debug(`Successfully loaded ${toolSkills.length} ${paths.relativeDirPath} skills`);
    return toolSkills;
  }

  async loadToolDirsToDelete(): Promise<AiDir[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });

    const skillsDirPath = join(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs(join(skillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));

    const toolSkills = dirNames.map((dirName) =>
      factory.class.forDeletion({
        baseDir: this.baseDir,
        relativeDirPath: paths.relativeDirPath,
        dirName,
        global: this.global,
      }),
    );

    logger.debug(
      `Successfully loaded ${toolSkills.length} ${paths.relativeDirPath} skills for deletion`,
    );
    return toolSkills;
  }

  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false,
  }: {
    global?: boolean;
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (global) {
      return skillsProcessorToolTargetsGlobal;
    }
    const projectTargets = skillsProcessorToolTargetsProject;
    if (!includeSimulated) {
      return projectTargets.filter(
        (target) => !skillsProcessorToolTargetsSimulated.includes(target),
      );
    }
    return projectTargets;
  }

  /**
   * Return the simulated tool targets
   */
  static getToolTargetsSimulated(): ToolTarget[] {
    return skillsProcessorToolTargetsSimulated;
  }

  /**
   * Return the tool targets that this processor supports in global mode
   */
  static getToolTargetsGlobal(): ToolTarget[] {
    return skillsProcessorToolTargetsGlobal;
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid SkillsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolSkillFactory | undefined {
    // Validate that target is supported
    const result = SkillsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolSkillFactories.get(result.data);
  }
}
