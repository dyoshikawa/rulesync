import { join } from "node:path";

import { ConfigParams } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { RulesyncCommand } from "../features/commands/rulesync-command.js";
import { RulesyncIgnore } from "../features/ignore/rulesync-ignore.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { RulesyncRule } from "../features/rules/rulesync-rule.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { RulesyncSubagent } from "../features/subagents/rulesync-subagent.js";
import { ensureDir, fileExists, writeFileContent } from "../utils/file.js";

/**
 * Parameters for init function.
 */
export type InitParams = {
  /** Base directory for initialization. Defaults to process.cwd(). */
  baseDir?: string;
};

/**
 * Initialize rulesync in the specified directory.
 *
 * Creates the .rulesync directory structure with sample files and configuration.
 *
 * @param params - Optional parameters including baseDir
 * @example
 * ```typescript
 * import { init } from "rulesync";
 *
 * await init();
 * ```
 */
export async function init(params: InitParams = {}): Promise<void> {
  const baseDir = params.baseDir ?? process.cwd();
  await ensureDir(join(baseDir, RULESYNC_RELATIVE_DIR_PATH));
  await createSampleFiles(baseDir);
  await createConfigFile(baseDir);
}

async function createConfigFile(baseDir: string): Promise<void> {
  const configPath = join(baseDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH);
  if (await fileExists(configPath)) {
    return;
  }

  await writeFileContent(
    configPath,
    JSON.stringify(
      {
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: ["rules", "ignore", "mcp", "commands", "subagents", "skills"],
        baseDirs: ["."],
        delete: true,
        verbose: false,
        global: false,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        modularMcp: false,
      } satisfies ConfigParams,
      null,
      2,
    ),
  );
}

async function createSampleFiles(baseDir: string): Promise<void> {
  // Create rule sample file
  const sampleRuleFile = {
    filename: RULESYNC_OVERVIEW_FILE_NAME,
    content: `---
root: true
targets: ["*"]
description: "Project overview and general development guidelines"
globs: ["**/*"]
---

# Project Overview

## General Guidelines

- Use TypeScript for all new code
- Follow consistent naming conventions
- Write self-documenting code with clear variable and function names
- Prefer composition over inheritance
- Use meaningful comments for complex business logic

## Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use double quotes for strings
- Use trailing commas in multi-line objects and arrays

## Architecture Principles

- Organize code by feature, not by file type
- Keep related files close together
- Use dependency injection for better testability
- Implement proper error handling
- Follow single responsibility principle
`,
  };

  // Create MCP sample file
  const sampleMcpFile = {
    filename: "mcp.json",
    content: `{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--enable-web-dashboard",
        "false",
        "--project",
        "."
      ],
      "env": {}
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
  }
}
`,
  };

  // Create command sample file
  const sampleCommandFile = {
    filename: "review-pr.md",
    content: `---
description: 'Review a pull request'
targets: ["*"]
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

1. Check code quality and style consistency
2. Review test coverage
3. Verify documentation updates
4. Check for potential bugs or security issues

Then provide a summary of findings and suggestions for improvement.
`,
  };

  // Create subagent sample file
  const sampleSubagentFile = {
    filename: "planner.md",
    content: `---
name: planner
targets: ["*"]
description: >-
  This is the general-purpose planner. The user asks the agent to plan to
  suggest a specification, implement a new feature, refactor the codebase, or
  fix a bug. This agent can be called by the user explicitly only.
claudecode:
  model: inherit
---

You are the planner for any tasks.

Based on the user's instruction, create a plan while analyzing the related files. Then, report the plan in detail. You can output files to @tmp/ if needed.

Attention, again, you are just the planner, so though you can read any files and run any commands for analysis, please don't write any code.
`,
  };

  // Create skill sample file
  const sampleSkillFile = {
    dirName: "project-context",
    content: `---
name: project-context
description: "Summarize the project context and key constraints"
targets: ["*"]
---

Summarize the project goals, core constraints, and relevant dependencies.
Call out any architecture decisions, shared conventions, and validation steps.
Keep the summary concise and ready to reuse in future tasks.`,
  };

  // Create ignore sample file
  const sampleIgnoreFile = {
    content: `credentials/
`,
  };

  // Get paths from settable paths
  const rulePaths = RulesyncRule.getSettablePaths();
  const mcpPaths = RulesyncMcp.getSettablePaths();
  const commandPaths = RulesyncCommand.getSettablePaths();
  const subagentPaths = RulesyncSubagent.getSettablePaths();
  const skillPaths = RulesyncSkill.getSettablePaths();
  const ignorePaths = RulesyncIgnore.getSettablePaths();

  // Ensure directories
  await ensureDir(join(baseDir, rulePaths.recommended.relativeDirPath));
  await ensureDir(join(baseDir, mcpPaths.recommended.relativeDirPath));
  await ensureDir(join(baseDir, commandPaths.relativeDirPath));
  await ensureDir(join(baseDir, subagentPaths.relativeDirPath));
  await ensureDir(join(baseDir, skillPaths.relativeDirPath));
  await ensureDir(join(baseDir, ignorePaths.recommended.relativeDirPath));

  // Create rule sample file
  const ruleFilepath = join(
    baseDir,
    rulePaths.recommended.relativeDirPath,
    sampleRuleFile.filename,
  );
  if (!(await fileExists(ruleFilepath))) {
    await writeFileContent(ruleFilepath, sampleRuleFile.content);
  }

  // Create MCP sample file
  const mcpFilepath = join(
    baseDir,
    mcpPaths.recommended.relativeDirPath,
    mcpPaths.recommended.relativeFilePath,
  );
  if (!(await fileExists(mcpFilepath))) {
    await writeFileContent(mcpFilepath, sampleMcpFile.content);
  }

  // Create command sample file
  const commandFilepath = join(baseDir, commandPaths.relativeDirPath, sampleCommandFile.filename);
  if (!(await fileExists(commandFilepath))) {
    await writeFileContent(commandFilepath, sampleCommandFile.content);
  }

  // Create subagent sample file
  const subagentFilepath = join(
    baseDir,
    subagentPaths.relativeDirPath,
    sampleSubagentFile.filename,
  );
  if (!(await fileExists(subagentFilepath))) {
    await writeFileContent(subagentFilepath, sampleSubagentFile.content);
  }

  // Create skill sample file
  const skillDirPath = join(baseDir, skillPaths.relativeDirPath, sampleSkillFile.dirName);
  await ensureDir(skillDirPath);
  const skillFilepath = join(skillDirPath, SKILL_FILE_NAME);
  if (!(await fileExists(skillFilepath))) {
    await writeFileContent(skillFilepath, sampleSkillFile.content);
  }

  // Create ignore sample file
  const ignoreFilepath = join(
    baseDir,
    ignorePaths.recommended.relativeDirPath,
    ignorePaths.recommended.relativeFilePath,
  );
  if (!(await fileExists(ignoreFilepath))) {
    await writeFileContent(ignoreFilepath, sampleIgnoreFile.content);
  }
}
