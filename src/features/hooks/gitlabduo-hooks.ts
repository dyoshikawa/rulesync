import { join } from "node:path";

import { GITLABDUO_DIR, GITLABDUO_HOOKS_FILE_NAME } from "../../constants/gitlabduo-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import {
  CANONICAL_TO_GITLABDUO_EVENT_NAMES,
  GITLABDUO_HOOK_EVENTS,
  GITLABDUO_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  buildImportedHooksConfig,
  canonicalToToolHooks,
  toolHooksToCanonical,
} from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

// GitLab Duo CLI documents the `SessionStart` event, command hooks with an
// optional regex `matcher` on the session source (`startup`, `resume`), and a
// per-hook `timeout` in seconds. gitlab-lsp also reads `PreToolUse` (matcher on
// `tool_name`) and `SessionEnd` (matcher on the end reason) from the same file.
// Hook processes get `DUO_PROJECT_DIR`, so `./`-relative script paths are
// anchored to it (bare executables such as `npx ...` are left intact).
// https://docs.gitlab.com/user/gitlab_duo_cli/customize/
const GITLABDUO_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: GITLABDUO_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_GITLABDUO_EVENT_NAMES,
  toolToCanonicalEventNames: GITLABDUO_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$DUO_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  supportedHookTypes: new Set(["command"]),
};

/**
 * GitLab Duo CLI hooks.
 *
 * Hooks live in a dedicated file, `<project>/.gitlab/duo/hooks.json` (project,
 * opt-in via `--enable-project-hooks` / `GITLAB_ENABLE_PROJECT_HOOKS=true`) or
 * `~/.gitlab/duo/hooks.json` (user), shaped as `{ "hooks": { "SessionStart": [...], "PreToolUse": [...] } }`.
 * rulesync owns the whole file, so it is regenerated and deleted as a unit.
 */
export class GitlabduoHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: GITLABDUO_DIR, relativeFilePath: GITLABDUO_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<GitlabduoHooks> {
    const paths = GitlabduoHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new GitlabduoHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<GitlabduoHooks> {
    const paths = GitlabduoHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const gitlabduoHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.gitlabduo?.hooks,
      converterConfig: GITLABDUO_CONVERTER_CONFIG,
      logger,
    });
    const fileContent = JSON.stringify({ hooks: gitlabduoHooks }, null, 2);
    return new GitlabduoHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const settings: { hooks?: unknown } = this.parseFileContentOrThrow({
      displayName: "GitLab Duo CLI",
      parse: (fileContent) => JSON.parse(fileContent),
    });
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: GITLABDUO_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "gitlabduo" }),
        null,
        2,
      ),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): GitlabduoHooks {
    return new GitlabduoHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
