import { readFile } from "node:fs/promises";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export type AugmentcodeIgnoreParams = ToolIgnoreParams;

/**
 * AugmentCode Ignore implementation
 *
 * AugmentCode uses a two-tier approach for file exclusion:
 * 1. First pass: .gitignore patterns are evaluated (standard Git behavior)
 * 2. Second pass: .augmentignore patterns are evaluated (can re-include files)
 *
 * Key features:
 * - Single .augmentignore file at repository root
 * - Supports negation patterns (!pattern) for re-including files
 * - Works alongside Git ignore patterns
 * - Security-focused default patterns
 *
 * File format follows standard gitignore syntax:
 * - Comments start with #
 * - Blank lines are ignored
 * - Supports wildcards (*, ?, **)
 * - Leading ! negates patterns (re-includes files)
 */
export class AugmentcodeIgnore extends ToolIgnore {
  /**
   * Convert to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  /**
   * Create AugmentcodeIgnore from RulesyncIgnore
   * Supports conversion from unified rulesync format to AugmentCode specific format
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): AugmentcodeIgnore {
    return new AugmentcodeIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".augmentignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  /**
   * Create AugmentcodeIgnore from file path
   * Reads and parses .augmentignore file
   */
  static async fromFile(): Promise<AugmentcodeIgnore> {
    const fileContent = await readFile(".augmentignore", "utf-8");

    return new AugmentcodeIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".augmentignore",
      fileContent,
    });
  }
}
