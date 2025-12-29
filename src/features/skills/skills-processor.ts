import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiDir } from "../../types/ai-dir.js";
import { DirFeatureProcessor } from "../../types/dir-feature-processor.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdSkill } from "./agentsmd-skill.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { CodexCliSkill } from "./codexcli-skill.js";
import { CopilotSkill } from "./copilot-skill.js";
import { CursorSkill } from "./cursor-skill.js";
import { GeminiCliSkill } from "./geminicli-skill.js";
import { OpenCodeSkill } from "./opencode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill } from "./simulated-skill.js";
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
  "claudecode",
  "claudecode-legacy",
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
  "opencode",
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
      meta: { supportsProject: false, supportsSimulated: false, supportsGlobal: true },
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
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliSkill,
      meta: { supportsProject: true, supportsSimulated: true, supportsGlobal: false },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeSkill,
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
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
  }) {
    super({ baseDir });
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
   */
  async loadRulesyncDirs(): Promise<AiDir[]> {
    const paths = RulesyncSkill.getSettablePaths();
    const rulesyncSkillsDirPath = join(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs(join(rulesyncSkillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));

    const rulesyncSkills = await Promise.all(
      dirNames.map((dirName) =>
        RulesyncSkill.fromDir({ baseDir: this.baseDir, dirName, global: this.global }),
      ),
    );

    logger.info(`Successfully loaded ${rulesyncSkills.length} rulesync skills`);
    return rulesyncSkills;
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

    logger.info(`Successfully loaded ${toolSkills.length} ${paths.relativeDirPath} skills`);
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

    logger.info(
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
}
