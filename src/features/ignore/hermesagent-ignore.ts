import { basename, join } from "node:path";
// cspell:ignore gitwildmatch pathspec splitlines

import {
  HERMESAGENT_IGNORE_PLUGIN_DIR_PATH,
  HERMESAGENT_IGNORE_PLUGIN_INIT_PATH,
  HERMESAGENT_IGNORE_PLUGIN_MANIFEST_PATH,
  HERMESAGENT_IGNORE_PLUGIN_OWNERSHIP_PATH,
  HERMESAGENT_IGNORE_PLUGIN_PATTERNS_PATH,
} from "../../constants/hermesagent-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { readFileContent, readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

function getPluginManifestContent(): string {
  return [
    "name: rulesync-ignore",
    'version: "1.0.0"',
    "description: Enforces RuleSync ignore patterns for Hermes file tools.",
    "",
  ].join("\n");
}

function getPluginInitContent(): string {
  return `"""RuleSync-generated project ignore enforcement for Hermes."""

import json
import re
from pathlib import Path

import pathspec


PROJECT_ROOT = Path(__file__).resolve().parents[3]
PATTERNS_FILE = Path(__file__).parent / "patterns.gitignore"
PROTECTED_TOOLS = {"read_file", "write_file", "patch"}


def _spec():
    if not PATTERNS_FILE.exists():
        return pathspec.PathSpec.from_lines("gitwildmatch", [])
    return pathspec.PathSpec.from_lines("gitwildmatch", PATTERNS_FILE.read_text(encoding="utf-8").splitlines())


def _relative_path(value):
    if not value or value == "/dev/null":
        return None
    path = Path(str(value))
    try:
        resolved = path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()
        return resolved.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return None


def _patch_paths(content):
    paths = []
    pattern = r"^(?:\\*\\*\\* (?:Update|Delete|Add) File:|---|\\+\\+\\+)\\s+(?:a/|b/)?(.+)$"
    for line in str(content or "").splitlines():
        match = re.match(pattern, line)
        if match:
            paths.append(match.group(1).strip())
    return paths


def _tool_paths(tool_name, args):
    if tool_name in {"read_file", "write_file"}:
        return [args.get("path")]
    if tool_name == "patch":
        return [args.get("path"), *_patch_paths(args.get("patch") or args.get("content"))]
    return []


def block_ignored_file_tools(tool_name, args, **kwargs):
    del kwargs
    if tool_name not in PROTECTED_TOOLS or not isinstance(args, dict):
        return None
    ignored = []
    matcher = _spec()
    for value in _tool_paths(tool_name, args):
        relative = _relative_path(value)
        if relative and matcher.match_file(relative):
            ignored.append(relative)
    if ignored:
        return {"action": "block", "message": "Blocked by RuleSync ignore patterns: " + ", ".join(sorted(set(ignored)))}
    return None


def _filter_json(value, matcher):
    if isinstance(value, list):
        return [item for item in (_filter_json(item, matcher) for item in value) if item is not None]
    if isinstance(value, dict):
        candidate = value.get("path") or value.get("file") or value.get("filename")
        relative = _relative_path(candidate)
        if relative and matcher.match_file(relative):
            return None
        return {key: filtered for key, item in value.items() if (filtered := _filter_json(item, matcher)) is not None}
    return value


def filter_search_results(tool_name, arguments, result, **kwargs):
    del arguments, kwargs
    if tool_name != "search_files":
        return None
    matcher = _spec()
    try:
        return json.dumps(_filter_json(json.loads(result), matcher))
    except (json.JSONDecodeError, TypeError):
        kept = []
        for line in str(result).splitlines():
            candidate = _relative_path(line.split(":", 1)[0].strip())
            if not candidate or not matcher.match_file(candidate):
                kept.append(line)
        return "\\n".join(kept)


def register(ctx):
    ctx.register_hook("pre_tool_call", block_ignored_file_tools)
    ctx.register_hook("transform_tool_result", filter_search_results)
`;
}

class HermesagentIgnoreAuxiliaryFile extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  getFileContent(): string {
    if (this.getRelativePathFromCwd() === toPosixPath(HERMESAGENT_IGNORE_PLUGIN_MANIFEST_PATH)) {
      return getPluginManifestContent();
    }
    if (this.getRelativePathFromCwd() === toPosixPath(HERMESAGENT_IGNORE_PLUGIN_INIT_PATH)) {
      return getPluginInitContent();
    }
    return super.getFileContent();
  }
}

export class HermesagentIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: HERMESAGENT_IGNORE_PLUGIN_DIR_PATH,
      relativeFilePath: basename(HERMESAGENT_IGNORE_PLUGIN_PATTERNS_PATH),
    };
  }

  static async getAuxiliaryFiles({
    outputRoot,
  }: {
    toolIgnore: ToolIgnore;
    outputRoot?: string;
  }): Promise<ToolFile[]> {
    return [
      new HermesagentIgnoreAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_IGNORE_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_IGNORE_PLUGIN_MANIFEST_PATH),
        fileContent: "",
      }),
      new HermesagentIgnoreAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_IGNORE_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_IGNORE_PLUGIN_OWNERSHIP_PATH),
        fileContent: "Generated and owned by RuleSync.\n",
      }),
      new HermesagentIgnoreAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_IGNORE_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_IGNORE_PLUGIN_INIT_PATH),
        fileContent: "",
      }),
    ];
  }

  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const marker = await readFileContentOrNull(
      join(outputRoot, HERMESAGENT_IGNORE_PLUGIN_OWNERSHIP_PATH),
    );
    return marker === "Generated and owned by RuleSync.\n";
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): HermesagentIgnore {
    const paths = this.getSettablePaths();
    return new HermesagentIgnore({
      outputRoot,
      ...paths,
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<HermesagentIgnore> {
    const paths = this.getSettablePaths();
    return new HermesagentIgnore({
      outputRoot,
      ...paths,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): HermesagentIgnore {
    return new HermesagentIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
