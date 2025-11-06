import { join } from "node:path";
import { RulesyncCommand } from "../../commands/rulesync-command.js";
import { ConfigParams } from "../../config/config.js";
import { RulesyncIgnore } from "../../ignore/rulesync-ignore.js";
import { RulesyncMcp } from "../../mcp/rulesync-mcp.js";
import { RulesyncRule } from "../../rules/rulesync-rule.js";
import { RulesyncSubagent } from "../../subagents/rulesync-subagent.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

export async function initCommand(): Promise<void> {
  logger.info("Initializing rulesync...");

  await ensureDir(".rulesync");
  await createSampleFiles();
  await createConfigFile();

  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(`1. Edit .rulesync/**/*.md, .rulesync/mcp.json and .rulesyncignore`);
  logger.info("2. Run 'rulesync generate' to create configuration files");
}

async function createConfigFile(): Promise<void> {
  if (await fileExists("rulesync.jsonc")) {
    logger.info("Skipped rulesync.jsonc (already exists)");
    return;
  }

  await writeFileContent(
    "rulesync.jsonc",
    JSON.stringify(
      {
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: ["rules", "ignore", "mcp", "commands", "subagents"],
        baseDirs: ["."],
        delete: true,
        verbose: false,
        global: false,
        simulatedCommands: false,
        simulatedSubagents: false,
        modularMcp: false,
      } satisfies ConfigParams,
      null,
      2,
    ),
  );

  logger.success("Created rulesync.jsonc");
}

async function createSampleFiles(): Promise<void> {
  // Create rule sample file
  const sampleRuleFile = {
    filename: "overview.md",
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
  const ignorePaths = RulesyncIgnore.getSettablePaths();

  // Ensure directories
  await ensureDir(rulePaths.recommended.relativeDirPath);
  await ensureDir(mcpPaths.recommended.relativeDirPath);
  await ensureDir(commandPaths.relativeDirPath);
  await ensureDir(subagentPaths.relativeDirPath);
  await ensureDir(ignorePaths.relativeDirPath);

  // Create rule sample file
  const ruleFilepath = join(rulePaths.recommended.relativeDirPath, sampleRuleFile.filename);
  if (!(await fileExists(ruleFilepath))) {
    await writeFileContent(ruleFilepath, sampleRuleFile.content);
    logger.success(`Created ${ruleFilepath}`);
  } else {
    logger.info(`Skipped ${ruleFilepath} (already exists)`);
  }

  // Create MCP sample file
  const mcpFilepath = join(
    mcpPaths.recommended.relativeDirPath,
    mcpPaths.recommended.relativeFilePath,
  );
  if (!(await fileExists(mcpFilepath))) {
    await writeFileContent(mcpFilepath, sampleMcpFile.content);
    logger.success(`Created ${mcpFilepath}`);
  } else {
    logger.info(`Skipped ${mcpFilepath} (already exists)`);
  }

  // Create command sample file
  const commandFilepath = join(commandPaths.relativeDirPath, sampleCommandFile.filename);
  if (!(await fileExists(commandFilepath))) {
    await writeFileContent(commandFilepath, sampleCommandFile.content);
    logger.success(`Created ${commandFilepath}`);
  } else {
    logger.info(`Skipped ${commandFilepath} (already exists)`);
  }

  // Create subagent sample file
  const subagentFilepath = join(subagentPaths.relativeDirPath, sampleSubagentFile.filename);
  if (!(await fileExists(subagentFilepath))) {
    await writeFileContent(subagentFilepath, sampleSubagentFile.content);
    logger.success(`Created ${subagentFilepath}`);
  } else {
    logger.info(`Skipped ${subagentFilepath} (already exists)`);
  }

  // Create ignore sample file
  const ignoreFilepath = join(ignorePaths.relativeDirPath, ignorePaths.relativeFilePath);
  if (!(await fileExists(ignoreFilepath))) {
    await writeFileContent(ignoreFilepath, sampleIgnoreFile.content);
    logger.success(`Created ${ignoreFilepath}`);
  } else {
    logger.info(`Skipped ${ignoreFilepath} (already exists)`);
  }
}
