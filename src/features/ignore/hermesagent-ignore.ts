import { basename, join } from "node:path";
// cspell:ignore abspath expanduser gitwildmatch normpath pathspec splitlines

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
import os
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


def _relative_paths(value):
    if not value or value == "/dev/null":
        return []
    path = Path(str(value)).expanduser()
    lexical = Path(os.path.abspath(os.path.normpath(str(path if path.is_absolute() else PROJECT_ROOT / path))))
    candidates = [lexical]
    try:
        resolved = lexical.resolve()
        if resolved != lexical:
            candidates.append(resolved)
    except OSError:
        pass

    relatives = []
    for candidate in candidates:
        try:
            relative = candidate.relative_to(PROJECT_ROOT).as_posix()
        except ValueError:
            continue
        if relative not in relatives:
            relatives.append(relative)
    return relatives


def _is_ignored_path(value, matcher):
    return any(matcher.match_file(relative) for relative in _relative_paths(value))


def _patch_paths(content):
    paths = []
    for line in str(content or "").splitlines():
        match = re.match(r"^\\*\\*\\*\\s*(?:Update|Delete|Add)\\s+File:\\s*(.+)$", line)
        if match:
            paths.append(match.group(1).strip())
            continue
        match = re.match(r"^\\*\\*\\*\\s*Move\\s+File:\\s*(.+?)\\s*->\\s*(.+)$", line)
        if match:
            paths.extend([match.group(1).strip(), match.group(2).strip()])
            continue
        match = re.match(r"^(?:---|\\+\\+\\+)\\s+(?:a/|b/)?(.+)$", line)
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
        relatives = _relative_paths(value)
        if any(matcher.match_file(relative) for relative in relatives):
            ignored.extend(relatives)
    if ignored:
        return {"action": "block", "message": "Blocked by RuleSync ignore patterns: " + ", ".join(sorted(set(ignored)))}
    return None


def _filter_matches_text(value, matcher):
    kept = []
    keep_group = True
    has_path = False
    for line in str(value or "").splitlines():
        is_match_line = re.match(r"^  \\d+: ", line) is not None
        if not has_path or not is_match_line or _is_ignored_path(line, matcher):
            keep_group = not _is_ignored_path(line, matcher)
            has_path = True
        if keep_group:
            kept.append(line)
    return "\\n".join(kept)


def _filter_json(value, matcher, parent_key=None):
    if isinstance(value, list):
        if parent_key == "files":
            return [item for item in value if not _is_ignored_path(item, matcher)]
        return [item for item in (_filter_json(item, matcher) for item in value) if item is not None]
    if isinstance(value, dict):
        candidate = value.get("path") or value.get("file") or value.get("filename")
        if _is_ignored_path(candidate, matcher):
            return None
        filtered = {}
        for key, item in value.items():
            if key == "counts" and isinstance(item, dict):
                filtered[key] = {
                    path: count for path, count in item.items()
                    if not _is_ignored_path(path, matcher)
                }
                continue
            if key == "matches_text":
                filtered[key] = _filter_matches_text(item, matcher)
                continue
            nested = _filter_json(item, matcher, key)
            if nested is not None:
                filtered[key] = nested

        if isinstance(filtered.get("counts"), dict):
            filtered["total_count"] = sum(filtered["counts"].values())
        elif isinstance(filtered.get("files"), list):
            filtered["total_count"] = len(filtered["files"])
        elif isinstance(filtered.get("matches"), list):
            filtered["total_count"] = len(filtered["matches"])
        elif "matches_text" in filtered:
            filtered["total_count"] = sum(
                1 for line in filtered["matches_text"].splitlines()
                if re.match(r"^  \\d+: ", line) is not None
            )
        return filtered
    return value


def filter_search_results(tool_name, arguments, result, **kwargs):
    del arguments, kwargs
    if tool_name != "search_files":
        return None
    matcher = _spec()
    raw_result = str(result)
    payload, separator, hint = raw_result.partition("\\n\\n[Hint:")
    try:
        filtered = json.dumps(_filter_json(json.loads(payload), matcher))
        return filtered + (separator + hint if separator else "")
    except (json.JSONDecodeError, TypeError):
        kept = []
        for line in raw_result.splitlines():
            candidate = line.split(":", 1)[0].strip()
            if not _is_ignored_path(candidate, matcher):
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
