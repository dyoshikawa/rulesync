import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { fileExists, readFileContent, readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export class ClaudecodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  /**
   * In global mode, ~/.claude.json should not be deleted as it is the
   * user's primary Claude Code config and contains many other settings
   * managed by Claude Code itself (feature flags, project trust list,
   * hooks, user settings, model selection, etc.).
   * In local mode, .mcp.json can be safely deleted.
   */
  override isDeletable(): boolean {
    return !this.global;
  }

  /**
   * Legacy global path used by rulesync ≤ v8.17.0. The documented store
   * is `~/.claude.json`; `fromFile` falls back here with a deprecation
   * warning (mirrors PR #333). Never modified or removed by rulesync.
   */
  private static readonly LEGACY_GLOBAL_DIR = ".claude";
  private static readonly LEGACY_GLOBAL_FILE = ".claude.json";

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: ".",
        relativeFilePath: ".claude.json",
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromFileParams): Promise<ClaudecodeMcp> {
    const paths = this.getSettablePaths({ global });
    const recommendedPath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Try the recommended path first.
    if (await fileExists(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      const json = JSON.parse(fileContent);
      const newJson = { ...json, mcpServers: json.mcpServers ?? {} };
      return new ClaudecodeMcp({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        fileContent: JSON.stringify(newJson, null, 2),
        validate,
        global,
      });
    }

    // Backward compatibility: fall back to the legacy path with a
    // deprecation warning. Mirrors `RulesyncMcp.fromFile` (PR #333).
    if (global) {
      const legacyPath = join(
        outputRoot,
        ClaudecodeMcp.LEGACY_GLOBAL_DIR,
        ClaudecodeMcp.LEGACY_GLOBAL_FILE,
      );
      if (await fileExists(legacyPath)) {
        logger?.warn(
          `Warning: using deprecated path "${legacyPath}". Please migrate to "${recommendedPath}"`,
        );
        const fileContent = await readFileContent(legacyPath);
        const json = JSON.parse(fileContent);
        const newJson = { ...json, mcpServers: json.mcpServers ?? {} };
        // Reflect the legacy path so callers see where data came from;
        // `fromRulesyncMcp` always writes to the recommended path.
        return new ClaudecodeMcp({
          outputRoot,
          relativeDirPath: ClaudecodeMcp.LEGACY_GLOBAL_DIR,
          relativeFilePath: ClaudecodeMcp.LEGACY_GLOBAL_FILE,
          fileContent: JSON.stringify(newJson, null, 2),
          validate,
          global,
        });
      }
    }

    // Neither recommended nor legacy exists: initialize empty mcpServers
    // at the recommended path (existing fromFile contract).
    return new ClaudecodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<ClaudecodeMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);

    const mcpJson = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    // The legacy path `~/.claude/.claude.json` is intentionally not touched
    // here — see the LEGACY_GLOBAL_* docstring above for the rationale.

    return new ClaudecodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers ?? {} }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): ClaudecodeMcp {
    return new ClaudecodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
