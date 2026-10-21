import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_PATH,
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_INIT_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH,
} from "../../constants/hermesagent-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { type ValidationResult } from "../../types/ai-file.js";
import {
  getHermesagentConfigSharedFileKey,
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
  getHermesagentSharedConfigWritePaths,
} from "../../utils/hermesagent.js";
import {
  getHermesQueueUserMessagePython,
  hermesSlashName,
} from "../shared/hermes-plugin-commands.js";
import { applySharedConfigPatch, parseSharedConfig } from "../shared/shared-config-gateway.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  type ToolSubagentForDeletionParams,
  type ToolSubagentFromFileParams,
  type ToolSubagentFromRulesyncSubagentParams,
} from "./tool-subagent.js";

type ToolSubagentsFromRulesyncSubagentsParams = {
  rulesyncSubagents: RulesyncSubagent[];
  outputRoot?: string;
  global?: boolean;
};

function subagentSlug(relativeFilePath: string): string {
  return basename(relativeFilePath, ".md").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function hermesCommandName(slug: string): string {
  return hermesSlashName(`rulesync-subagent-${slug}`);
}

function getPluginManifestContent(): string {
  return [
    "name: rulesync-subagents",
    'version: "1.0.0"',
    "description: Exposes RuleSync subagents as Hermes slash commands that queue a delegation prompt.",
    "",
  ].join("\n");
}

function getPluginInitContent(): string {
  return `"""RuleSync-generated Hermes subagent commands."""

import json
import logging
import re
from pathlib import Path


logger = logging.getLogger(__name__)
SUBAGENTS_DIR = Path(__file__).resolve().parents[2] / "rulesync" / "subagents"


def _load_subagents():
    if not SUBAGENTS_DIR.exists():
        return []

    subagents = []
    for path in sorted(SUBAGENTS_DIR.glob("*.json")):
        try:
            subagent = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(subagent, dict):
            subagent["_path"] = str(path)
            subagents.append(subagent)
    return subagents


def _command_name(subagent, slug):
    # The spec carries the name Rulesync normalized; Hermes' messaging gateway
    # resolves plugin commands with "_" turned into "-", so keep it hyphenated.
    hermes = subagent.get("hermes")
    name = hermes.get("command") if isinstance(hermes, dict) else None
    name = name or f"rulesync-subagent-{slug}"
    # Mirrors hermesSlashName() in src/features/shared/hermes-plugin-commands.ts.
    name = re.sub(r"[ _]", "-", str(name).lower())
    name = re.sub(r"[^a-z0-9-]", "", name)
    return re.sub(r"-{2,}", "-", name).strip("-")


${getHermesQueueUserMessagePython({ pluginName: "rulesync-subagents" })}

def _register_subagent(ctx, subagent, registered):
    slug = subagent.get("slug")
    if not slug:
        return

    command_name = _command_name(subagent, slug)
    if command_name in registered:
        logger.warning(
            "rulesync-subagents: %s and %s both map to /%s; keeping the first.",
            registered[command_name],
            subagent.get("_path"),
            command_name,
        )
        return
    registered[command_name] = subagent.get("_path")

    name = subagent.get("name") or slug
    description = subagent.get("description") or f"Delegate work to the {name} RuleSync subagent."
    system_prompt = subagent.get("prompt") or ""

    def handler(args=None, **kwargs):
        user_context = ""
        if isinstance(args, dict):
            user_context = args.get("context") or args.get("task") or args.get("prompt") or ""
        elif args is not None:
            user_context = str(args)

        # A slash command runs outside any agent turn, so calling delegate_task
        # here fails with "delegate_task requires a parent agent context".
        # Queue the brief as a user message instead; the agent then delegates.
        parts = [
            f"Use the delegate_task tool to hand the following task to a subagent "
            f"acting as the {name} RuleSync subagent.",
            f"Goal: {description}",
        ]
        if system_prompt:
            parts.append(f"Subagent instructions:\\n{system_prompt}")
        if user_context:
            parts.append(f"Task details:\\n{user_context}")

        label = f"the {name} subagent task"
        error = _queue_user_message(ctx, "\\n\\n".join(parts), kwargs, label)
        return error or f"Queued {label}; the agent will delegate it."

    ctx.register_command(command_name, handler, description)


def register(ctx):
    registered = {}
    for subagent in _load_subagents():
        _register_subagent(ctx, subagent, registered)
`;
}

function getEnabledPluginConfigContent({
  currentContent,
  global,
}: {
  currentContent: string;
  global: boolean;
}): string {
  const config = parseSharedConfig({ format: "yaml", fileContent: currentContent });
  const plugins =
    config.plugins && typeof config.plugins === "object"
      ? (config.plugins as Record<string, unknown>)
      : {};
  const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];

  return applySharedConfigPatch({
    fileKey: getHermesagentConfigSharedFileKey({ global }),
    feature: "subagents",
    existingContent: currentContent,
    patch: {
      plugins: {
        ...plugins,
        enabled: Array.from(new Set([...enabled, "rulesync-subagents"])),
      },
    },
  });
}

function getSubagentSpec(rulesyncSubagent: RulesyncSubagent): Record<string, unknown> {
  const json = rulesyncSubagent.getFrontmatter();
  const slug = subagentSlug(rulesyncSubagent.getRelativePathFromCwd());
  const name = typeof json.name === "string" && json.name.length > 0 ? json.name : slug;
  const description =
    typeof json.description === "string" && json.description.length > 0
      ? json.description
      : `Delegate work to the ${name} RuleSync subagent.`;

  return {
    slug,
    name,
    description,
    prompt: rulesyncSubagent.getBody(),
    hermes: {
      command: hermesCommandName(slug),
      dispatch: "inject_message",
    },
  };
}

export class HermesagentSubagent extends ToolSubagent {
  static forDeletion({
    global = false,
    outputRoot,
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): HermesagentSubagent {
    return new HermesagentSubagent({
      fileContent: "",
      global,
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      validate: false,
    });
  }

  static async fromFile({
    global = false,
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
  }: ToolSubagentFromFileParams): Promise<HermesagentSubagent> {
    const resolvedRelativeDirPath =
      relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath;
    return new HermesagentSubagent({
      fileContent: await readFile(
        join(outputRoot, resolvedRelativeDirPath, relativeFilePath),
        "utf8",
      ),
      global,
      outputRoot,
      relativeDirPath: resolvedRelativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      validate,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    const targets = rulesyncSubagent.getFrontmatter().targets;

    return !targets || targets.includes("*") || targets.includes("hermesagent");
  }

  static fromRulesyncSubagents({
    rulesyncSubagents,
    outputRoot,
    global = false,
  }: ToolSubagentsFromRulesyncSubagentsParams): HermesagentSubagent[] {
    const pluginDirPath = getHermesagentRelativeDirPath({
      global,
      relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
    });
    return [
      ...rulesyncSubagents.map((rulesyncSubagent) =>
        HermesagentSubagent.fromRulesyncSubagent({
          relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
          rulesyncSubagent,
          outputRoot,
          global,
        }),
      ),
      new HermesagentSubagent({
        relativeDirPath: pluginDirPath,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH),
        fileContent: "",
        outputRoot,
        global,
      }),
      new HermesagentSubagent({
        relativeDirPath: pluginDirPath,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_INIT_PATH),
        fileContent: "",
        outputRoot,
        global,
      }),
      ...(global
        ? [
            new HermesagentSubagent({
              relativeDirPath: getHermesagentRelativeDirPath({
                global,
                relativeDirPath: HERMESAGENT_GLOBAL_DIR,
              }),
              relativeFilePath: basename(HERMESAGENT_CONFIG_FILE_PATH),
              fileContent: "",
              outputRoot,
              global,
            }),
          ]
        : []),
    ];
  }

  static fromRulesyncSubagent({
    rulesyncSubagent,
    outputRoot,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): HermesagentSubagent {
    const spec = getSubagentSpec(rulesyncSubagent);
    const slug = String(spec.slug);

    return new HermesagentSubagent({
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: `${slug}.json`,
      fileContent: `${JSON.stringify(spec, null, 2)}\n`,
      outputRoot,
      global,
    });
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): {
    relativeDirPath: string;
  } {
    return {
      relativeDirPath: getHermesagentRelativeDirPath({
        global,
        relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
      }),
    };
  }

  /**
   * Beyond the subagent spec files, generation also read-modify-writes the
   * shared `~/.hermes/config.yaml` (enabling the `rulesync-subagents` plugin),
   * so the write must be declared for the shared-file order derivation.
   */
  /**
   * `config.yaml` under every spelling the global profile root can take.
   * @see getHermesagentSharedConfigWritePaths
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return getHermesagentSharedConfigWritePaths();
  }

  static getSettablePathsForRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): string[] {
    const slug = subagentSlug(rulesyncSubagent.getRelativePathFromCwd());

    return [join(HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH, `${slug}.json`)];
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const slug = basename(this.getRelativeFilePath(), ".json");
    const json = JSON.parse(this.getFileContent()) as {
      name?: string;
      description?: string;
      prompt?: string;
    };

    return new RulesyncSubagent({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${slug}.md`,
      body: json.prompt ?? "",
      frontmatter: {
        name: json.name ?? slug,
        description: json.description,
      },
      outputRoot: this.global
        ? getHermesagentRulesyncOutputRoot({
            nativeOutputRoot: this.outputRoot,
            global: this.global,
          })
        : process.cwd(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  shouldMergeExistingFileContent(): boolean {
    return this.getRelativeFilePath() === basename(HERMESAGENT_CONFIG_FILE_PATH);
  }

  setFileContent(newFileContent: string): void {
    if (this.getRelativeFilePath() === basename(HERMESAGENT_CONFIG_FILE_PATH)) {
      super.setFileContent(
        getEnabledPluginConfigContent({ currentContent: newFileContent, global: this.global }),
      );
      return;
    }

    super.setFileContent(newFileContent);
  }

  getFileContent(): string {
    if (
      this.getRelativeFilePath() === basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH)
    ) {
      return getPluginManifestContent();
    }

    if (this.getRelativeFilePath() === basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_INIT_PATH)) {
      return getPluginInitContent();
    }

    if (this.getRelativeFilePath() === basename(HERMESAGENT_CONFIG_FILE_PATH)) {
      return getEnabledPluginConfigContent({
        currentContent: super.getFileContent(),
        global: this.global,
      });
    }

    return super.getFileContent();
  }
}
