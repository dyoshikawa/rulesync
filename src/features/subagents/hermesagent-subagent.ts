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
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
  getHermesagentSharedConfigWritePaths,
} from "../../utils/hermesagent.js";
import {
  applySharedConfigPatch,
  HERMES_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
} from "../shared/shared-config-gateway.js";
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
  return `rulesync_subagent_${slug}`;
}

function getPluginManifestContent(): string {
  return [
    "name: rulesync-subagents",
    'version: "1.0.0"',
    "description: Exposes RuleSync subagents as Hermes native delegation commands.",
    "",
  ].join("\n");
}

function getPluginInitContent(): string {
  return `"""RuleSync-generated Hermes subagent commands."""

import json
from pathlib import Path


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


def _register_subagent(ctx, subagent):
    slug = subagent.get("slug")
    if not slug:
        return

    command_name = f"rulesync_subagent_{slug}"
    name = subagent.get("name") or slug
    description = subagent.get("description") or f"Delegate work to the {name} RuleSync subagent."
    system_prompt = subagent.get("prompt") or ""

    def handler(args=None, **kwargs):
        del kwargs
        user_context = ""
        if isinstance(args, dict):
            user_context = args.get("context") or args.get("task") or args.get("prompt") or ""
        elif args is not None:
            user_context = str(args)

        context_parts = []
        if system_prompt:
            context_parts.append(system_prompt)
        if user_context:
            context_parts.append(user_context)

        # delegate_task takes no model-facing "toolsets" argument: a subagent
        # inherits the parent's enabled toolsets (role="orchestrator" is the
        # only knob that changes them).
        return ctx.dispatch_tool(
            "delegate_task",
            {
                "goal": description,
                "context": "\\n\\n".join(context_parts),
            },
        )

    ctx.register_command(command_name, handler, description)


def register(ctx):
    for subagent in _load_subagents():
        _register_subagent(ctx, subagent)
`;
}

function getEnabledPluginConfigContent(currentContent: string): string {
  const config = parseSharedConfig({ format: "yaml", fileContent: currentContent });
  const plugins =
    config.plugins && typeof config.plugins === "object"
      ? (config.plugins as Record<string, unknown>)
      : {};
  const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];

  return applySharedConfigPatch({
    fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
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
      dispatch: "delegate_task",
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
        relativeDirPath: getHermesagentRelativeDirPath({
          global,
          relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
        }),
        relativeFilePath: basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH),
        fileContent: "",
        outputRoot,
        global,
      }),
      new HermesagentSubagent({
        relativeDirPath: getHermesagentRelativeDirPath({
          global,
          relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
        }),
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
      super.setFileContent(getEnabledPluginConfigContent(newFileContent));
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
      return getEnabledPluginConfigContent(super.getFileContent());
    }

    return super.getFileContent();
  }
}
