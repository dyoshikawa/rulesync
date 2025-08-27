import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { Processor } from "../types/processor.js";
import { ToolTarget } from "../types/tool-targets.js";
import { directoryExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { CodexcliIgnore } from "./codexcli-ignore.js";
import { OpencodeIgnore } from "./opencode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

export const IgnoreProcessorToolTargetSchema = z.enum(["claudecode", "codexcli", "opencode"]);

export type IgnoreProcessorToolTarget = z.infer<typeof IgnoreProcessorToolTargetSchema>;

export class IgnoreProcessor extends Processor {
  private readonly toolTarget: IgnoreProcessorToolTarget;

  constructor({ baseDir, toolTarget }: { baseDir: string; toolTarget: IgnoreProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = IgnoreProcessorToolTargetSchema.parse(toolTarget);
  }

  async writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores: RulesyncIgnore[]): Promise<void> {
    const toolIgnores = rulesyncIgnores
      .filter((rulesyncIgnore) => {
        const frontmatter = rulesyncIgnore.getFrontmatter();
        const targets = frontmatter.targets;

        // Check if this ignore file targets the current tool or wildcard
        if (Array.isArray(targets)) {
          if (targets.length === 1 && targets[0] === "*") {
            return true; // Wildcard target
          }
          // targets is ToolTargets (string[]) when not wildcard
          return targets.some((target: string): target is ToolTarget => target === this.toolTarget);
        }
        return false;
      })
      .map((rulesyncIgnore) => {
        switch (this.toolTarget) {
          case "claudecode":
            return ClaudecodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              relativeDirPath: ".claude",
              rulesyncIgnore,
            });
          case "codexcli":
            return CodexcliIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              relativeDirPath: ".",
              rulesyncIgnore,
            });
          case "opencode":
            return OpencodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              relativeDirPath: ".",
              rulesyncIgnore,
            });
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      });

    await this.writeAiFiles(toolIgnores);
  }

  async loadRulesyncIgnores(): Promise<RulesyncIgnore[]> {
    const ignoreDir = join(this.baseDir, ".rulesync", "ignore");

    // Check if directory exists
    if (!(await directoryExists(ignoreDir))) {
      throw new Error(`Rulesync ignore directory not found: ${ignoreDir}`);
    }

    // Read all markdown files from the directory
    const entries = await readdir(ignoreDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      throw new Error(`No markdown files found in rulesync ignore directory: ${ignoreDir}`);
    }

    logger.info(`Found ${mdFiles.length} ignore files in ${ignoreDir}`);

    // Parse all files and create RulesyncIgnore instances using fromFilePath
    const rulesyncIgnores: RulesyncIgnore[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(ignoreDir, mdFile);

      try {
        const rulesyncIgnore = await RulesyncIgnore.fromFilePath({
          filePath: filepath,
        });

        rulesyncIgnores.push(rulesyncIgnore);
        logger.debug(`Successfully loaded ignore: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load ignore file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncIgnores.length === 0) {
      throw new Error(`No valid ignore files found in ${ignoreDir}`);
    }

    logger.info(`Successfully loaded ${rulesyncIgnores.length} rulesync ignores`);
    return rulesyncIgnores;
  }

  async loadToolIgnores(): Promise<ToolIgnore[]> {
    switch (this.toolTarget) {
      case "claudecode":
        return await this.loadClaudecodeIgnores();
      case "codexcli":
        return await this.loadCodexcliIgnores();
      case "opencode":
        return await this.loadOpencodeIgnores();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  private async loadClaudecodeIgnores(): Promise<ToolIgnore[]> {
    // Claude Code uses settings.json files for configuration
    const supportedFiles = ClaudecodeIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, ".claude", filename);

      try {
        const claudeCodeIgnore = await ClaudecodeIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Claude Code ignore file: ${ignoreFilePath}`);
        return [claudeCodeIgnore];
      } catch (error) {
        // Continue to next file if this one fails
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    // If no ignore files found, return empty array
    logger.debug("No Claude Code configuration files found");
    return [];
  }

  private async loadCodexcliIgnores(): Promise<ToolIgnore[]> {
    // OpenAI Codex CLI doesn't have native ignore file support yet
    // Look for proposed .codexignore or .aiexclude files in project root
    const supportedFiles = CodexcliIgnore.getSupportedIgnoreFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const codexcliIgnore = await CodexcliIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Codex CLI ignore file: ${ignoreFilePath}`);
        return [codexcliIgnore];
      } catch (error) {
        // Continue to next file if this one fails
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    // If no ignore files found, return empty array (common case)
    logger.debug(
      "No Codex CLI ignore files found, which is expected since .codexignore is not yet implemented",
    );
    return [];
  }

  private async loadOpencodeIgnores(): Promise<ToolIgnore[]> {
    // OpenCode uses .gitignore primarily, but may have opencode.json with permission controls
    const supportedFiles = OpencodeIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const opencodeIgnore = await OpencodeIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded OpenCode ignore file: ${ignoreFilePath}`);
        return [opencodeIgnore];
      } catch (error) {
        // Continue to next file if this one fails
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    // If no ignore files found, return empty array (common case for OpenCode)
    logger.debug(
      "No OpenCode configuration files found, which is expected as OpenCode primarily relies on .gitignore",
    );
    return [];
  }

  async writeRulesyncIgnoresFromToolIgnores(toolIgnores: ToolIgnore[]): Promise<void> {
    const rulesyncIgnores = toolIgnores.map((toolIgnore) => {
      return toolIgnore.toRulesyncIgnore();
    });

    await this.writeAiFiles(rulesyncIgnores);
  }
}
