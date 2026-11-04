import { basename, extname } from "node:path";

import { TOOL_DISPLAY } from "../../types/tool-display.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import type { RulesyncRule } from "./rulesync-rule.js";

/**
 * Shared helpers for tool rule adapters that write opted-in rules as custom
 * output styles (`<tool dir>/output-styles/<name>.md`), e.g. Qoder and
 * Factory Droid. Both tools read only the direct `.md` children of their
 * output-styles directory, with optional `name` / `description` frontmatter.
 */

/**
 * Whether the given path is a direct `.md` child of `outputStylesDirPath`.
 */
export function isDirectMarkdownChild({
  outputStylesDirPath,
  relativeDirPath,
  relativeFilePath,
}: {
  outputStylesDirPath: string;
  relativeDirPath: string | undefined;
  relativeFilePath: string;
}): boolean {
  return (
    relativeDirPath === outputStylesDirPath &&
    extname(relativeFilePath) === ".md" &&
    basename(relativeFilePath) === relativeFilePath
  );
}

/**
 * Whether a rule opts into the `output-style` channel: only a non-root rule
 * can, since an output style is a file of its own.
 */
export function isOutputStyleChannel({
  root,
  channel,
}: {
  root: boolean | undefined;
  channel: string | undefined;
}): boolean {
  return !root && channel === "output-style";
}

/**
 * Return the file stem of an output-style source rule, throwing `message`
 * when the rule is nested in a subdirectory of the rules directory: the
 * output file is named after the rule, and the tools read only the top level
 * of their output-styles directory.
 */
export function resolveTopLevelOutputStyleStem({
  sourcePath,
  message,
}: {
  sourcePath: string;
  message: string;
}): string {
  if (basename(sourcePath) !== sourcePath) {
    throw new Error(message);
  }
  return basename(sourcePath, extname(sourcePath));
}

/**
 * The output style's frontmatter: only the `name` and `description` that are set.
 */
export function buildOutputStyleFrontmatter({
  name,
  description,
}: {
  name: string | undefined;
  description: string | undefined;
}): { name?: string; description?: string } {
  return {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
  };
}

/**
 * Warnings about `factorydroid` / `qoder` frontmatter that does not do what it
 * looks like it does: an `output-style` rule that also targets other tools
 * reaches them as an ordinary rule (so presentation instructions end up in
 * their project rules), and `<tool>.name` is read only with
 * `channel: output-style`. Checked while generating for that tool only, so
 * each warning prints once.
 */
export function getOutputStyleRuleOptionWarnings({
  rules,
  toolTarget,
  isTargetedByRulesyncRule,
}: {
  rules: RulesyncRule[];
  toolTarget: "factorydroid" | "qoder";
  isTargetedByRulesyncRule: (rule: RulesyncRule) => boolean;
}): string[] {
  const toolLabel = TOOL_DISPLAY.find((entry) => entry.key === toolTarget)?.label ?? toolTarget;
  const warnings: string[] = [];
  for (const rule of rules) {
    const frontmatter = rule.getFrontmatter();
    const section = frontmatter[toolTarget];
    if (frontmatter.root || !section || !isTargetedByRulesyncRule(rule)) {
      continue;
    }
    const { channel, name } = section;
    const fileName = stripControlCharacters(rule.getRelativeFilePath());
    const targets = frontmatter.targets ?? ["*"];
    if (channel === "output-style" && targets.some((target) => target !== toolTarget)) {
      warnings.push(
        `${fileName} sets ${toolTarget}.channel: output-style but also targets other tools, which receive it as an ordinary rule. Set \`targets: ["${toolTarget}"]\` to keep the output style to ${toolLabel}.`,
      );
    }
    if (channel !== "output-style" && name !== undefined) {
      warnings.push(
        `${fileName} sets ${toolTarget}.name, which is read only with ${toolTarget}.channel: output-style; ignoring it.`,
      );
    }
  }
  return warnings;
}
