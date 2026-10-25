import { dirname, isAbsolute, join } from "node:path";

import { assertTargetsFeaturesExclusive, ConfigFile, ConfigFileSchema } from "../config/config.js";
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_CONFIG_SCHEMA_URL,
  RULESYNC_USER_CONFIG_DIR_NAME,
  RULESYNC_XDG_CONFIG_HOME_DEFAULT_DIR_NAME,
} from "../constants/rulesync-paths.js";
import { formatError } from "../utils/error.js";
import {
  assertPathResolvesInsideRoot,
  ensureDir,
  fileExists,
  getHomeDirectory,
  isSymlink,
  PathOutsideRootError,
  readFileContent,
  writeFileContent,
} from "../utils/file.js";
import { parseJsonc } from "../utils/jsonc.js";
import { createFeatureScaffold } from "./feature-scaffold.js";

type InitFileResult = {
  created: boolean;
  path: string;
  /**
   * Set when the file was not created because writing it would have gone
   * through a symbolic link that leads outside the project or is dangling.
   */
  outsideProject?: true;
};

type InitConfigFileResult = InitFileResult & {
  /**
   * The user-level config file whose `targets` / `features` seeded the new
   * `rulesync.jsonc`, when one was found and the file was created.
   */
  seededFrom?: string;
};

export type InitResult = {
  configFile: InitConfigFileResult;
  sampleFiles: InitFileResult[];
};

/** The `targets` / `features` pair `init` writes when no user config exists. */
const DEFAULT_CONFIG_TEMPLATE: Pick<ConfigFile, "targets" | "features"> = {
  targets: ["codexcli", "claudecode", "opencode"],
  features: ["rules", "mcp", "subagents", "skills", "hooks", "permissions"],
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

/**
 * Resolve the user-level config file `init` reads its `targets` / `features`
 * template from: `$XDG_CONFIG_HOME/rulesync/rulesync.jsonc`, falling back to
 * `~/.config/rulesync/rulesync.jsonc` when `XDG_CONFIG_HOME` is unset or not
 * an absolute path (the XDG spec says a relative value must be ignored).
 */
export function getUserConfigFilePath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome =
    xdgConfigHome !== undefined && isAbsolute(xdgConfigHome)
      ? xdgConfigHome
      : join(getHomeDirectory(), RULESYNC_XDG_CONFIG_HOME_DEFAULT_DIR_NAME);
  return join(configHome, RULESYNC_USER_CONFIG_DIR_NAME, RULESYNC_CONFIG_RELATIVE_FILE_PATH);
}

type UserConfigTemplate = {
  path: string;
  template: Pick<ConfigFile, "targets" | "features">;
};

/**
 * Read the `targets` / `features` defaults from the user-level config file.
 * Returns `undefined` when the file is absent or declares neither key. A file
 * that exists but cannot be parsed or validated fails loudly: silently
 * falling back would write defaults the user did not ask for.
 */
async function loadUserConfigTemplate(): Promise<UserConfigTemplate | undefined> {
  const path = getUserConfigFilePath();
  if (!(await fileExists(path))) {
    return undefined;
  }

  let parsed: ConfigFile;
  try {
    parsed = ConfigFileSchema.parse(parseJsonc(await readFileContent(path)));
    assertTargetsFeaturesExclusive({ targets: parsed.targets, features: parsed.features });
  } catch (error) {
    throw new Error(
      `Failed to load the user config ${JSON.stringify(path)}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }

  const { targets, features } = parsed;
  if (targets === undefined && features === undefined) {
    return undefined;
  }

  // Object-form `targets` carries its own per-target features, so the
  // generated file must omit the top-level `features` key.
  const targetsIsObject = targets !== undefined && !Array.isArray(targets);
  return {
    path,
    template: {
      targets: targets ?? DEFAULT_CONFIG_TEMPLATE.targets,
      ...(targetsIsObject ? {} : { features: features ?? DEFAULT_CONFIG_TEMPLATE.features }),
    },
  };
}

/**
 * Whether anything occupies `path`, a symbolic link included. A plain `stat`
 * reads a dangling link as absent, and writing to it would then create the
 * link's target, wherever that is.
 */
async function pathEntryExists(path: string): Promise<boolean> {
  return (await fileExists(path)) || (await isSymlink(path));
}

async function createConfigFile(): Promise<InitConfigFileResult> {
  const path = RULESYNC_CONFIG_RELATIVE_FILE_PATH;

  if (await pathEntryExists(path)) {
    return { created: false, path };
  }

  const userConfig = await loadUserConfigTemplate();
  const template = userConfig?.template ?? DEFAULT_CONFIG_TEMPLATE;

  await assertInitWriteInsideProject(path);
  await writeFileContent(
    path,
    JSON.stringify(
      {
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        ...template,
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

  return userConfig === undefined
    ? { created: true, path }
    : { created: true, path, seededFrom: userConfig.path };
}

function createSampleScaffolds() {
  return [
    createFeatureScaffold({ feature: "rule", name: "overview" }),
    createFeatureScaffold({ feature: "mcp" }),
    createFeatureScaffold({ feature: "subagent", name: "planner" }),
    createFeatureScaffold({ feature: "skill", name: "project-context" }),
    createFeatureScaffold({ feature: "hooks" }),
    createFeatureScaffold({ feature: "permissions" }),
  ];
}

/**
 * Refuse a write `init` is about to make when it would go through a symbolic
 * link (dangling or not) that leads outside the project — a cloned repository
 * committing `.rulesync -> ~/elsewhere`, say. A link that stays inside the
 * project is written through.
 */
async function assertInitWriteInsideProject(path: string): Promise<void> {
  await assertPathResolvesInsideRoot({ rootPath: process.cwd(), targetPath: path });
}

/**
 * Create each sample file that does not exist yet. A sample whose write would
 * leave the project through a symbolic link is skipped and reported with
 * `outsideProject`, rather than failing the run: a `.rulesync` linked to a
 * shared tree elsewhere is a supported layout, the sample content is fixed
 * text, and the project's own files (`rulesync.jsonc`) should still be created.
 */
async function createSampleFiles(): Promise<InitFileResult[]> {
  const results: InitFileResult[] = [];
  for (const sample of createSampleScaffolds()) {
    results.push(
      await writeIfNotExists({
        path: sample.relativeFilePath,
        candidatePaths: sample.candidateRelativeFilePaths,
        content: sample.content,
      }),
    );
  }
  return results;
}

async function writeIfNotExists({
  path,
  candidatePaths,
  content,
}: {
  path: string;
  candidatePaths: string[];
  content: string;
}): Promise<InitFileResult> {
  for (const candidatePath of candidatePaths) {
    if (await pathEntryExists(candidatePath)) {
      return { created: false, path: candidatePath };
    }
  }

  try {
    // Checked before the directory is created and again right before the
    // write, as `add` does, so neither step goes through a link out.
    await assertInitWriteInsideProject(path);
    await ensureDir(dirname(path));
    await assertInitWriteInsideProject(path);
  } catch (error) {
    if (error instanceof PathOutsideRootError) {
      return { created: false, path, outsideProject: true };
    }
    throw error;
  }
  await writeFileContent(path, content);
  return { created: true, path };
}
