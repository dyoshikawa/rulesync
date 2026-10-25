import { basename, extname, join } from "node:path";

import { XUM_DIR, XUM_RULE_FILE_NAME } from "../../constants/xum-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

/** An ATX level-1 heading line (`# Title`), which Xum's parser treats as an H1. */
const ATX_H1_LINE = /^ {0,3}#(?:[ \t]|$)/;

/**
 * Make `body` start at a level-1 heading, adding `# <heading>` when it does not
 * already open with one.
 *
 * Xum reads `.xum/AGENTS.md` (and appends `AGENTS.local.md`) as one Markdown
 * document and treats a `Mode:` / `Model:` / `Tool:` heading as a scoped
 * section that runs until the next heading of the same or a higher level.
 * Fragments rulesync concatenates into that document — folded topic rules and
 * the local overlay — would otherwise fall inside a scoped section the
 * preceding fragment ends with, and Xum would inject them only in that mode.
 * Only an H1 closes a section of any level, so each such fragment opens with
 * one.
 *
 * @see https://github.com/coder/xum/blob/main/src/node/utils/main/markdown.ts
 */
export function ensureXumSectionBoundary({
  body,
  heading,
}: {
  body: string;
  heading: string;
}): string {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim() !== "");
  if (firstLine !== undefined && ATX_H1_LINE.test(firstLine)) {
    return body;
  }
  // A heading text of its own must not open a scoped section (`Mode: plan`).
  const safeHeading = heading.replaceAll(/[\r\n:]/g, " ").trim() || "Instructions";
  return body.trim() === "" ? `# ${safeHeading}\n` : `# ${safeHeading}\n\n${body}`;
}

/** The heading a folded rule opens with: its file name without the extension. */
function xumRuleHeading(rulesyncRule: RulesyncRule): string {
  const fileName = basename(rulesyncRule.getRelativeFilePath());
  return fileName.slice(0, fileName.length - extname(fileName).length);
}

/**
 * Settable paths for Xum rules. Xum reads a single Xum-dedicated instruction
 * file per directory and has no rules directory, so there is no `nonRoot`
 * location: rulesync's topic-based non-root rules are folded into the root
 * file by the RulesProcessor.
 */
export type XumRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

/**
 * Rule generator for Xum (Coder's parallel coding-agent app, formerly Mux).
 *
 * Xum layers its own `.xum/AGENTS.md` (project) and `~/.xum/AGENTS.md` (user)
 * on top of the shared root `AGENTS.md` / `AGENT.md` / `CLAUDE.md`, which the
 * `agentsmd` target already writes, so this target writes only the
 * Xum-dedicated file. Only these files honor the `## Model: <regex>` and
 * `## Mode: <mode>` scoped sections; rulesync passes the body through as-is,
 * so such sections authored in a rule keep working. The personal
 * `.xum/AGENTS.local.md` overlay is written for a `localRoot: true` rule.
 *
 * @see https://xum.cdr.dev/agents/instruction-files
 */
export class XumRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): XumRuleSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return {
      root: {
        relativeDirPath: XUM_DIR,
        relativeFilePath: XUM_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<XumRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new XumRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): XumRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new XumRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      // A non-root rule is folded into the root file after other fragments, so
      // it must open at a section boundary (see ensureXumSectionBoundary).
      fileContent: isRoot
        ? rulesyncRule.getBody()
        : ensureXumSectionBoundary({
            body: rulesyncRule.getBody(),
            heading: xumRuleHeading(rulesyncRule),
          }),
      validate,
      root: isRoot,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): XumRule {
    const isRoot = relativeFilePath === XUM_RULE_FILE_NAME && relativeDirPath === XUM_DIR;

    return new XumRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  protected static override readonly toolTarget = "xum";
}
