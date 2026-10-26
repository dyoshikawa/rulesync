import { AUGMENTCODE_IGNORE_FILE_NAME } from "../../constants/augmentcode-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

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
export class AugmentcodeIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: AUGMENTCODE_IGNORE_FILE_NAME,
    };
  }
}
