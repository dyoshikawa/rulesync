import { join } from "node:path";

import {
  CLINE_COMMANDS_DIR_PATH,
  CLINE_COMMANDS_GLOBAL_DIR_PATH,
} from "../../constants/cline-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// The workflow frontmatter fields Cline type-checks. A value of the wrong type
// makes Cline reject the whole workflow ("Frontmatter field 'disabled' must be
// a boolean"), so such a value is dropped with a warning instead of written.
const CLINE_WORKFLOW_FIELD_TYPES: Record<string, "string" | "boolean"> = {
  name: "string",
  disabled: "boolean",
  enabled: "boolean",
};

function sanitizeClineWorkflowFrontmatter({
  cline,
  relativeFilePath,
  logger,
}: {
  cline: unknown;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  if (!isRecord(cline)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(cline).filter(([key, value]) => {
      const expected = Object.hasOwn(CLINE_WORKFLOW_FIELD_TYPES, key)
        ? CLINE_WORKFLOW_FIELD_TYPES[key]
        : undefined;
      if (expected === undefined || typeof value === expected) {
        return true;
      }
      warnWithFallback(
        logger,
        `Cline commands: dropping cline.${key} from ${relativeFilePath}: Cline rejects the whole workflow unless it is a ${expected}.`,
      );
      return false;
    }),
  );
}

/**
 * Cline workflows (commands). A workflow may carry YAML frontmatter that Cline
 * reads: `name` (the slash-command name) and a `disabled` / `enabled` switch
 * (`parseWorkflowConfigFromMarkdown` in Cline's
 * `user-instruction-config-loader.ts`). The `cline:` section of a
 * `.rulesync/commands/*.md` file is written as that frontmatter, and every key
 * of an imported workflow's frontmatter is lifted back into `cline:`, so
 * hand-written workflow frontmatter survives an import → generate round trip.
 * Cline's own UI toggle is kept in Cline's state, not in the file. A workflow
 * without a `cline:` section is written as a bare body, as before.
 *
 * @see https://github.com/cline/cline/blob/main/sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts
 */
export class ClineCommand extends ToolCommand {
  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (global) {
      return {
        relativeDirPath: CLINE_COMMANDS_GLOBAL_DIR_PATH,
      };
    }

    return {
      relativeDirPath: CLINE_COMMANDS_DIR_PATH,
    };
  }

  /** The workflow's own frontmatter, or an empty object for a bare body. */
  private getClineFrontmatter(): Record<string, unknown> {
    const { frontmatter } = parseFrontmatter(this.getFileContent(), this.getFilePath());
    return isRecord(frontmatter) ? frontmatter : {};
  }

  toRulesyncCommand(): RulesyncCommand {
    const cline = this.getClineFrontmatter();
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      ...(Object.keys(cline).length > 0 && { cline }),
    };
    const body = this.getBody();

    return new RulesyncCommand({
      outputRoot: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
    logger,
  }: ToolCommandFromRulesyncCommandParams): ClineCommand {
    const paths = this.getSettablePaths({ global });
    const cline = sanitizeClineWorkflowFrontmatter({
      cline: rulesyncCommand.getFrontmatter().cline,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      logger,
    });
    const body = rulesyncCommand.getBody();

    return new ClineCommand({
      outputRoot: outputRoot,
      fileContent: Object.keys(cline).length > 0 ? stringifyFrontmatter(body, cline) : body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  getBody(): string {
    return parseFrontmatter(this.getFileContent(), this.getFilePath()).body.trim();
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "cline",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<ClineCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);
    const cline = isRecord(frontmatter) ? frontmatter : {};

    return new ClineCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent:
        Object.keys(cline).length > 0 ? stringifyFrontmatter(body.trim(), cline) : body.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): ClineCommand {
    return new ClineCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
