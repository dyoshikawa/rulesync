import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_PATH,
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_INIT_PATH,
  HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH,
} from "../../constants/hermesagent-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFile, type ValidationResult } from "../../types/ai-file.js";
import { parseHermesConfig, stringifyHermesConfig } from "../hermes-config.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

type ToolSubagentFromRulesyncSubagentParams = {
  rulesyncSubagent: RulesyncSubagent;
  outputRoot?: string;
};

type ToolSubagentsFromRulesyncSubagentsParams = {
  rulesyncSubagents: RulesyncSubagent[];
  outputRoot?: string;
};

type ToolSubagentFromFileParams = {
  global?: boolean;
  outputRoot?: string;
  relativeFilePath: string;
  validate?: boolean;
};

type ToolSubagentForDeletionParams = {
  global?: boolean;
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
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


SUBAGENTS_DIR = Path.home() / ".hermes" / "rulesync" / "subagents"


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
    toolsets = subagent.get("toolsets") or ["terminal", "file", "web"]

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

        return ctx.dispatch_tool(
            "delegate_task",
            {
                "goal": description,
                "context": "\\n\\n".join(context_parts),
                "toolsets": toolsets,
            },
        )

    ctx.register_command(command_name, handler, description)


def register(ctx):
    for subagent in _load_subagents():
        _register_subagent(ctx, subagent)
`;
}

function getEnabledPluginConfigContent(currentContent: string): string {
  const config = parseHermesConfig(currentContent);
  const plugins =
    config.plugins && typeof config.plugins === "object"
      ? (config.plugins as Record<string, unknown>)
      : {};
  const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];

  config.plugins = {
    ...plugins,
    enabled: Array.from(new Set([...enabled, "rulesync-subagents"])),
  };

  return stringifyHermesConfig(config);
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
    toolsets: ["terminal", "file", "web"],
    hermes: {
      command: hermesCommandName(slug),
      dispatch: "delegate_task",
    },
  };
}

export class HermesagentSubagent extends AiFile {
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
    relativeFilePath,
    validate = true,
  }: ToolSubagentFromFileParams): Promise<HermesagentSubagent> {
    return new HermesagentSubagent({
      fileContent: await readFile(join(outputRoot, relativeFilePath), "utf8"),
      global,
      outputRoot,
      relativeDirPath: dirname(relativeFilePath),
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
  }: ToolSubagentsFromRulesyncSubagentsParams): HermesagentSubagent[] {
    return [
      ...rulesyncSubagents.map((rulesyncSubagent) =>
        HermesagentSubagent.fromRulesyncSubagent({ rulesyncSubagent, outputRoot }),
      ),
      new HermesagentSubagent({
        relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_MANIFEST_PATH),
        fileContent: "",
        outputRoot,
      }),
      new HermesagentSubagent({
        relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_SUBAGENTS_PLUGIN_INIT_PATH),
        fileContent: "",
        outputRoot,
      }),
      new HermesagentSubagent({
        relativeDirPath: HERMESAGENT_GLOBAL_DIR,
        relativeFilePath: basename(HERMESAGENT_CONFIG_FILE_PATH),
        fileContent: "",
        outputRoot,
      }),
    ];
  }

  static fromRulesyncSubagent({
    rulesyncSubagent,
    outputRoot,
  }: ToolSubagentFromRulesyncSubagentParams): HermesagentSubagent {
    const spec = getSubagentSpec(rulesyncSubagent);
    const slug = String(spec.slug);

    return new HermesagentSubagent({
      relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
      relativeFilePath: `${slug}.json`,
      fileContent: `${JSON.stringify(spec, null, 2)}\n`,
      outputRoot,
    });
  }

  static getSettablePaths(): { relativeDirPath: string } {
    return {
      relativeDirPath: HERMESAGENT_RULESYNC_SUBAGENTS_DIR_PATH,
    };
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
      relativeFilePath: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, `${slug}.md`),
      body: json.prompt ?? "",
      frontmatter: {
        name: json.name ?? slug,
        description: json.description,
      },
      outputRoot: this.outputRoot,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
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
