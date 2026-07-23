import { dirname } from "node:path";

import { ConfigFile } from "../config/config.js";
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_CONFIG_SCHEMA_URL,
} from "../constants/rulesync-paths.js";
import { ensureDir, fileExists, writeFileContent } from "../utils/file.js";
import { createFeatureScaffold } from "./feature-scaffold.js";

type InitFileResult = {
  created: boolean;
  path: string;
};

export type InitResult = {
  configFile: InitFileResult;
  sampleFiles: InitFileResult[];
};

/**
 * Initialize rulesync configuration and sample files.
 * This is the core logic without CLI-specific logging.
 */
export async function init(): Promise<InitResult> {
  const sampleFiles = await createSampleFiles();
  const configFile = await createConfigFile();

  return {
    configFile,
    sampleFiles,
  };
}

async function createConfigFile(): Promise<InitFileResult> {
  const path = RULESYNC_CONFIG_RELATIVE_FILE_PATH;

  if (await fileExists(path)) {
    return { created: false, path };
  }

  await writeFileContent(
    path,
    JSON.stringify(
      {
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: [
          "rules",
          "ignore",
          "mcp",
          "commands",
          "subagents",
          "skills",
          "hooks",
          "permissions",
        ],
        outputRoots: ["."],
        delete: true,
        verbose: false,
        silent: false,
        global: false,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        gitignoreTargetsOnly: true,
      } satisfies ConfigFile,
      null,
      2,
    ),
  );

  return { created: true, path };
}

async function createSampleFiles(): Promise<InitFileResult[]> {
  const samples = [
    createFeatureScaffold({ feature: "rule", name: "overview" }),
    createFeatureScaffold({ feature: "mcp" }),
    createFeatureScaffold({ feature: "command", name: "review-pr" }),
    createFeatureScaffold({ feature: "subagent", name: "planner" }),
    createFeatureScaffold({ feature: "skill", name: "project-context" }),
    createFeatureScaffold({ feature: "ignore" }),
    createFeatureScaffold({ feature: "hooks" }),
    createFeatureScaffold({ feature: "permissions" }),
  ];

  const results: InitFileResult[] = [];
  for (const sample of samples) {
    await ensureDir(dirname(sample.relativeFilePath));
    results.push(await writeIfNotExists(sample.relativeFilePath, sample.content));
  }
  return results;
}

async function writeIfNotExists(path: string, content: string): Promise<InitFileResult> {
  if (await fileExists(path)) {
    return { created: false, path };
  }

  await writeFileContent(path, content);
  return { created: true, path };
}
