import { basename, join } from "node:path";

import { RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiDir } from "../../types/ai-dir.js";
import { DirFeatureProcessor } from "../../types/dir-feature-processor.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { directoryExists, findFilesByGlobs } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { ClaudecodeScheduledTask } from "./claudecode-scheduled-task.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkill } from "./tool-skill.js";

export class ScheduledTasksProcessor extends DirFeatureProcessor {
  constructor({
    baseDir = process.cwd(),
    dryRun = false,
    logger,
  }: {
    baseDir?: string;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ baseDir, dryRun, logger });
  }

  async loadRulesyncDirs(): Promise<AiDir[]> {
    const scheduledTasksDirPath = join(process.cwd(), RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH);
    if (!(await directoryExists(scheduledTasksDirPath))) {
      return [];
    }

    const dirPaths = await findFilesByGlobs(join(scheduledTasksDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));
    return Promise.all(
      dirNames.map((dirName) =>
        RulesyncSkill.fromDir({
          baseDir: process.cwd(),
          relativeDirPath: RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH,
          dirName,
          global: true,
        }),
      ),
    );
  }

  async convertRulesyncDirsToToolDirs(rulesyncDirs: AiDir[]): Promise<AiDir[]> {
    return rulesyncDirs
      .filter((dir): dir is RulesyncSkill => dir instanceof RulesyncSkill)
      .map((rulesyncSkill) =>
        ClaudecodeScheduledTask.fromRulesyncSkill({
          baseDir: this.baseDir,
          rulesyncSkill,
          global: true,
        }),
      );
  }

  async loadToolDirs(): Promise<AiDir[]> {
    const relativeDirPath = ClaudecodeScheduledTask.getSettablePaths().relativeDirPath;
    const scheduledTasksDirPath = join(this.baseDir, relativeDirPath);
    if (!(await directoryExists(scheduledTasksDirPath))) {
      return [];
    }

    const dirPaths = await findFilesByGlobs(join(scheduledTasksDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path) => basename(path));
    return Promise.all(
      dirNames.map((dirName) =>
        ClaudecodeScheduledTask.fromDir({
          baseDir: this.baseDir,
          relativeDirPath,
          dirName,
          global: true,
        }),
      ),
    );
  }

  async convertToolDirsToRulesyncDirs(toolDirs: AiDir[]): Promise<AiDir[]> {
    return toolDirs
      .filter((dir): dir is ToolSkill => dir instanceof ToolSkill)
      .map((toolSkill) => toolSkill.toRulesyncSkill());
  }

  async loadToolDirsToDelete(): Promise<AiDir[]> {
    const relativeDirPath = ClaudecodeScheduledTask.getSettablePaths().relativeDirPath;
    const scheduledTasksDirPath = join(this.baseDir, relativeDirPath);
    if (!(await directoryExists(scheduledTasksDirPath))) {
      return [];
    }

    const dirPaths = await findFilesByGlobs(join(scheduledTasksDirPath, "*"), { type: "dir" });
    return dirPaths.map((dirPath) =>
      ClaudecodeScheduledTask.forDeletion({
        baseDir: this.baseDir,
        relativeDirPath,
        dirName: basename(dirPath),
        global: true,
      }),
    );
  }

  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (!global) {
      return [];
    }
    return ["claudecode"];
  }
}
