import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { z } from "zod/mini";

import {
  HERMESAGENT_CONFIG_FILE_PATH,
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_RULESYNC_COMMANDS_DIR_PATH,
  HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_DIR_PATH,
  HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_INIT_PATH,
  HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_MANIFEST_PATH,
  HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_OWNERSHIP_PATH,
} from "../../constants/hermesagent-paths.js";
import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { findFilesByGlobs, readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import {
  applySharedConfigPatch,
  HERMES_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
} from "../shared/shared-config-gateway.js";
import { HermesagentSkill } from "../skills/hermesagent-skill.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandForDeletionParams,
  type ToolCommandFromFileParams,
  type ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

const HermesCommandSpecSchema = z.object({
  slug: z.string(),
  description: z.string(),
  prompt: z.string(),
});

type HermesCommandSpec = z.infer<typeof HermesCommandSpecSchema>;

function hermesSlashName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ _]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function getPluginManifestContent(): string {
  return [
    "name: rulesync-commands",
    'version: "1.0.0"',
    "description: Exposes RuleSync commands as Hermes native slash commands.",
    "",
  ].join("\n");
}

function getPluginInitContent(): string {
  return `"""RuleSync-generated Hermes slash commands."""

import json
from pathlib import Path


COMMANDS_DIR = Path(__file__).resolve().parents[2] / "rulesync" / "commands"


def _load_commands():
    if not COMMANDS_DIR.exists():
        return []

    commands = []
    for path in sorted(COMMANDS_DIR.glob("*.json")):
        try:
            command = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(command, dict):
            commands.append(command)
    return commands


def _register_command(ctx, command):
    slug = command.get("slug")
    if not slug:
        return

    description = command.get("description") or f"Run the {slug} RuleSync command."
    prompt = command.get("prompt") or ""

    def handler(args=None, **kwargs):
        del kwargs
        raw_args = ""
        if isinstance(args, dict):
            raw_args = args.get("args") or args.get("context") or args.get("prompt") or ""
        elif args is not None:
            raw_args = str(args)

        context_parts = [prompt] if prompt else []
        if raw_args:
            context_parts.append(f"User arguments:\\n{raw_args}")

        return ctx.dispatch_tool(
            "delegate_task",
            {
                "goal": description,
                "context": "\\n\\n".join(context_parts),
                "toolsets": ["terminal", "file", "web"],
            },
        )

    ctx.register_command(slug, handler, description)


def register(ctx):
    for command in _load_commands():
        _register_command(ctx, command)
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
    feature: "commands",
    existingContent: currentContent,
    patch: {
      plugins: {
        ...plugins,
        enabled: Array.from(new Set([...enabled, "rulesync-commands"])),
      },
    },
  });
}

export function getDisabledHermesCommandsPluginConfigContent(currentContent: string): string {
  const config = parseSharedConfig({ format: "yaml", fileContent: currentContent });
  const plugins =
    config.plugins && typeof config.plugins === "object"
      ? (config.plugins as Record<string, unknown>)
      : {};
  const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];

  return applySharedConfigPatch({
    fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
    feature: "commands",
    existingContent: currentContent,
    patch: {
      plugins: {
        ...plugins,
        enabled: enabled.filter((plugin) => plugin !== "rulesync-commands"),
      },
    },
  });
}

class HermesagentCommandAuxiliaryFile extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  shouldMergeExistingFileContent(): boolean {
    return this.getRelativePathFromCwd() === toPosixPath(HERMESAGENT_CONFIG_FILE_PATH);
  }

  setFileContent(newFileContent: string): void {
    if (this.getRelativePathFromCwd() === toPosixPath(HERMESAGENT_CONFIG_FILE_PATH)) {
      super.setFileContent(getEnabledPluginConfigContent(newFileContent));
      return;
    }
    super.setFileContent(newFileContent);
  }

  getFileContent(): string {
    if (
      this.getRelativePathFromCwd() ===
      toPosixPath(HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_MANIFEST_PATH)
    ) {
      return getPluginManifestContent();
    }
    if (
      this.getRelativePathFromCwd() === toPosixPath(HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_INIT_PATH)
    ) {
      return getPluginInitContent();
    }
    if (this.getRelativePathFromCwd() === toPosixPath(HERMESAGENT_CONFIG_FILE_PATH)) {
      return getEnabledPluginConfigContent(super.getFileContent());
    }
    return super.getFileContent();
  }
}

export class HermesagentCommand extends ToolCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({ rulesyncCommand, toolTarget: "hermesagent" });
  }

  static getSettablePaths(): { relativeDirPath: string } {
    return { relativeDirPath: HERMESAGENT_RULESYNC_COMMANDS_DIR_PATH };
  }

  static getExtraSharedWritePaths(): { relativeDirPath: string; relativeFilePath: string }[] {
    return [
      {
        relativeDirPath: HERMESAGENT_GLOBAL_DIR,
        relativeFilePath: basename(HERMESAGENT_CONFIG_FILE_PATH),
      },
    ];
  }

  static async validateRulesyncCommands({
    inputRoot,
    rulesyncCommands,
  }: {
    inputRoot: string;
    rulesyncCommands: RulesyncCommand[];
  }): Promise<void> {
    const commandSlugs = new Set<string>();
    const commandOrigins = new Map<string, string>();
    for (const command of rulesyncCommands.filter((candidate) =>
      this.isTargetedByRulesyncCommand(candidate),
    )) {
      const origin = command.getRelativeFilePath();
      const slug = hermesSlashName(basename(origin, ".md"));
      if (!slug) {
        throw new Error(`Hermes command "${origin}" does not produce a valid slash name.`);
      }
      const firstOrigin = commandOrigins.get(slug);
      if (firstOrigin && firstOrigin !== origin) {
        throw new Error(
          `Hermes command slash-name collision: "${firstOrigin}" and "${origin}" both normalize to "${slug}".`,
        );
      }
      commandOrigins.set(slug, origin);
      commandSlugs.add(slug);
    }
    const skillsRoot = join(inputRoot, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
    const skillFiles = await findFilesByGlobs(join(skillsRoot, "**", "SKILL.md"));
    const rulesyncSkills = await Promise.all(
      skillFiles.map((path) =>
        RulesyncSkill.fromDir({
          outputRoot: inputRoot,
          relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
          dirName: toPosixPath(relative(skillsRoot, dirname(path))),
        }),
      ),
    );
    const collisions = rulesyncSkills
      .filter((skill) => HermesagentSkill.isTargetedByRulesyncSkill(skill))
      .map((skill) => hermesSlashName(skill.getFrontmatter().name))
      .filter((slug) => commandSlugs.has(slug));
    if (collisions.length > 0) {
      throw new Error(
        `Hermes command and skill slash-name collision: ${[...new Set(collisions)].toSorted().join(", ")}`,
      );
    }
  }

  static async getAuxiliaryFiles({
    toolCommands,
    outputRoot,
    forDeletion = false,
  }: {
    toolCommands: ToolCommand[];
    outputRoot?: string;
    global?: boolean;
    forDeletion?: boolean;
  }): Promise<ToolFile[]> {
    if (toolCommands.length === 0 && !forDeletion) return [];
    const pluginFiles: ToolFile[] = [
      new HermesagentCommandAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_MANIFEST_PATH),
        fileContent: "",
      }),
      new HermesagentCommandAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_OWNERSHIP_PATH),
        fileContent: "Generated and owned by RuleSync.\n",
      }),
      new HermesagentCommandAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_INIT_PATH),
        fileContent: "",
      }),
    ];
    if (forDeletion) return pluginFiles;
    return [
      ...pluginFiles,
      new HermesagentCommandAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_GLOBAL_DIR,
        relativeFilePath: basename(HERMESAGENT_CONFIG_FILE_PATH),
        fileContent: "",
      }),
    ];
  }

  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const marker = await readFileContentOrNull(
      join(outputRoot, HERMESAGENT_RULESYNC_COMMANDS_PLUGIN_OWNERSHIP_PATH),
    );
    return marker === "Generated and owned by RuleSync.\n";
  }

  static override async fromFile({
    global = false,
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<HermesagentCommand> {
    const relativeDirPath = HERMESAGENT_RULESYNC_COMMANDS_DIR_PATH;
    return new HermesagentCommand({
      fileContent: await readFile(join(outputRoot, relativeDirPath, relativeFilePath), "utf8"),
      global,
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  static override forDeletion({
    global = false,
    outputRoot,
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): HermesagentCommand {
    return new HermesagentCommand({
      fileContent: "",
      global,
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      validate: false,
    });
  }

  static override fromRulesyncCommand({
    outputRoot,
    rulesyncCommand,
  }: ToolCommandFromRulesyncCommandParams): HermesagentCommand {
    const slug = hermesSlashName(basename(rulesyncCommand.getRelativeFilePath(), ".md"));
    const spec: HermesCommandSpec = {
      slug,
      description: rulesyncCommand.getFrontmatter().description ?? `${slug} command`,
      prompt: rulesyncCommand.getBody(),
    };
    return new HermesagentCommand({
      outputRoot,
      relativeDirPath: HERMESAGENT_RULESYNC_COMMANDS_DIR_PATH,
      relativeFilePath: `${slug}.json`,
      fileContent: `${JSON.stringify(spec, null, 2)}\n`,
    });
  }

  validate(): ValidationResult {
    try {
      const result = HermesCommandSpecSchema.safeParse(JSON.parse(this.fileContent));
      if (result.success) return { success: true, error: null };
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  toRulesyncCommand(): RulesyncCommand {
    const spec = HermesCommandSpecSchema.parse(JSON.parse(this.fileContent));
    return new RulesyncCommand({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: `${spec.slug}.md`,
      frontmatter: { description: spec.description },
      body: spec.prompt,
      fileContent: "",
      outputRoot: this.outputRoot,
    });
  }
}
