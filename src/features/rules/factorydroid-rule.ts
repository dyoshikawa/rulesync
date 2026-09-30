import { basename, extname, join } from "node:path";

import {
  FACTORYDROID_DESIGN_FILE_NAME,
  FACTORYDROID_DIR,
  FACTORYDROID_OUTPUT_STYLES_DIR_NAME,
  FACTORYDROID_RESERVED_OUTPUT_STYLE_NAMES,
  FACTORYDROID_RULE_FILE_NAME,
  FACTORYDROID_THREAT_MODEL_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Factory Droid instruction surfaces beyond `AGENTS.md` that a non-root rule
 * can opt into via the `factorydroid.channel` frontmatter key. `design` and
 * `threat-model` are single fixed files Factory Droid loads on its own, so
 * opted-in rules are concatenated into them; `output-style` writes each
 * opted-in rule as its own `.factory/output-styles/<name>.md`. Every channel
 * file is excluded from the root file's reference list.
 */
export type FactorydroidRuleChannel = "design" | "threat-model" | "output-style";

/**
 * The file-name glob `getExtraFixedFiles` returns for the output-styles
 * directory, so import enumerates every style in it (never deletion — see
 * `getExtraFixedFiles`): Droid loads "direct `.md` children of each
 * `output-styles` directory".
 */
const OUTPUT_STYLE_FILE_GLOB = "*.md";

export type FactorydroidRuleParams = AiFileParams & {
  root?: boolean;
  /**
   * Marks an instance whose body maps to one of Factory Droid's fixed-file
   * channels (`DESIGN.md`, `.factory/threat-model.md`) instead of the
   * coding-guidelines `AGENTS.md`.
   */
  channel?: FactorydroidRuleChannel;
};

type FactorydroidRuleChannelPath = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export type FactorydroidRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  /**
   * Factory Droid's design-guidelines file. Rules opt into this path via the
   * `factorydroid.channel: design` frontmatter block; multiple opted-in rules
   * are concatenated into this single file by the RulesProcessor. Project
   * scope only — see {@link FactorydroidRule} for why.
   */
  design: FactorydroidRuleChannelPath;
  /**
   * Factory Droid's security-review threat model. Rules opt into this path via
   * the `factorydroid.channel: threat-model` frontmatter block and are
   * concatenated the same way as `design`. Project scope only — see
   * {@link FactorydroidRule} for why.
   */
  threatModel: FactorydroidRuleChannelPath;
};

export type FactorydroidRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Factory Droid.
 *
 * Factory Droid loads the root `AGENTS.md` (project) / `~/.factory/AGENTS.md`
 * (global) as coding guidelines, plus non-root rules referenced from it via
 * `.factory/rules/*.md`.
 *
 * Factory Droid also loads two further fixed files (project only) as
 * independent instruction surfaces, which rulesync emits from any non-root
 * rule that opts in via a `factorydroid.channel` frontmatter key. Opted-in
 * rule bodies are routed to the channel's file instead of
 * `AGENTS.md`/`.factory/rules/*.md`, and multiple opted-in rules concatenate
 * in source order:
 *
 * - `design` → `DESIGN.md`: "Always-on design-system, UX, visual, and
 *   interaction guidance", loaded separately from `AGENTS.md`'s coding
 *   guidelines. Factory's docs describe `DESIGN.md` at the repository root and
 *   in nested subdirectories, like `AGENTS.md`, but document no
 *   personal/global home-directory equivalent.
 * - `threat-model` → `.factory/threat-model.md`: the attack-surface map
 *   Factory's Security Review reads — "if `.factory/threat-model.md` exists,
 *   Droid uses it as the attack-surface map". It is documented only as a
 *   repository file, so it has no global scope either.
 *
 * Both channels are therefore project scope only.
 *
 * A third channel, `output-style`, is directory-shaped rather than a fixed
 * file: each opted-in rule becomes its own custom output style,
 * `.factory/output-styles/<rule file name>.md`, with the rule's `description`
 * and optional `factorydroid.name` as the style's `name` / `description`
 * frontmatter. Factory documents the same directory under the home directory
 * (`~/.factory/output-styles/`), so this channel works at both scopes.
 * @see https://docs.factory.ai/harness/agents-md
 * @see https://docs.factory.ai/software-factory/security-review
 * @see https://docs.factory.ai/droid-cli/output-styles
 */
export class FactorydroidRule extends ToolRule {
  private readonly channel: FactorydroidRuleChannel | undefined;

  constructor({ fileContent, root, channel, ...rest }: FactorydroidRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
    this.channel = channel;
  }

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): FactorydroidRuleSettablePaths | FactorydroidRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(FACTORYDROID_DIR, ".", excludeToolDir),
          relativeFilePath: FACTORYDROID_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: FACTORYDROID_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(FACTORYDROID_DIR, "rules", excludeToolDir),
      },
      design: {
        relativeDirPath: ".",
        relativeFilePath: FACTORYDROID_DESIGN_FILE_NAME,
      },
      threatModel: {
        relativeDirPath: buildToolPath(FACTORYDROID_DIR, ".", excludeToolDir),
        relativeFilePath: FACTORYDROID_THREAT_MODEL_FILE_NAME,
      },
    };
  }

  /**
   * The directory custom output styles live in, `.factory/output-styles`
   * under the project root or the home directory alike.
   */
  static getOutputStylesDirPath({ excludeToolDir }: { excludeToolDir?: boolean } = {}): string {
    return buildToolPath(FACTORYDROID_DIR, FACTORYDROID_OUTPUT_STYLES_DIR_NAME, excludeToolDir);
  }

  /**
   * The fixed channel files in a fixed order, so that `getExtraFixedFiles` and
   * the channel lookups below agree on which paths are channels. Empty in
   * global mode, where neither file has a documented home-directory
   * equivalent.
   */
  private static getChannelPaths({
    global,
  }: {
    global: boolean;
  }): ReadonlyArray<{ channel: FactorydroidRuleChannel; path: FactorydroidRuleChannelPath }> {
    if (global) {
      return [];
    }
    const paths = this.getSettablePaths({ global }) as FactorydroidRuleSettablePaths;
    return [
      { channel: "design", path: paths.design },
      { channel: "threat-model", path: paths.threatModel },
    ];
  }

  /**
   * Whether the given output path is a custom output style: a direct `.md`
   * child of the output-styles directory, at either scope.
   */
  private static isOutputStylePath({
    relativeDirPath,
    relativeFilePath,
  }: {
    relativeDirPath: string | undefined;
    relativeFilePath: string;
  }): boolean {
    return (
      relativeDirPath === this.getOutputStylesDirPath() &&
      extname(relativeFilePath) === ".md" &&
      basename(relativeFilePath) === relativeFilePath
    );
  }

  /**
   * Which fixed-file channel, if any, owns the given output path. Matching on
   * `relativeDirPath` too (not just the basename) keeps a non-root rule that
   * happens to be named `DESIGN.md` or `threat-model.md` under
   * `.factory/rules/` from being routed to a channel by mistake.
   */
  private static findChannelByPath({
    relativeDirPath,
    relativeFilePath,
    global,
  }: {
    /** Optional on `fromFile`; an omitted directory never matches a channel. */
    relativeDirPath: string | undefined;
    relativeFilePath: string;
    global: boolean;
  }): { channel: FactorydroidRuleChannel; path: FactorydroidRuleChannelPath } | undefined {
    return this.getChannelPaths({ global }).find(
      ({ path }) =>
        relativeDirPath === path.relativeDirPath && relativeFilePath === path.relativeFilePath,
    );
  }

  /**
   * Extra files this tool manages beyond the root/non-root rules. The
   * RulesProcessor enumerates these for import and deletion so a stale
   * `DESIGN.md` or `.factory/threat-model.md` is cleaned up once no rule opts
   * in anymore. Output styles are enumerated for import only: the directory
   * also holds styles users write by hand (including their personal
   * `~/.factory/output-styles/`), and rulesync cannot tell those from the ones
   * it wrote, so `--delete` leaves the directory alone. Global mode lists only
   * the output-styles directory: neither fixed file has a documented
   * home-directory equivalent.
   */
  static getExtraFixedFiles({
    global = false,
  }: { global?: boolean } = {}): ToolRuleExtraFixedFile[] {
    return [
      ...this.getChannelPaths({ global }).map(({ path }) => path),
      {
        relativeDirPath: this.getOutputStylesDirPath(),
        relativeFilePath: OUTPUT_STYLE_FILE_GLOB,
        importOnly: true,
      },
    ];
  }

  /**
   * Non-root rules this tool can still emit in global mode, where it otherwise
   * has no non-root output: an `output-style` rule, since Factory documents
   * `~/.factory/output-styles/` as the user scope of the same surface.
   */
  static isEmittedAsGlobalNonRootRule(rulesyncRule: RulesyncRule): boolean {
    return this.isOutputStyleRule(rulesyncRule);
  }

  /** Whether a rule opts into the `output-style` channel (non-root only). */
  private static isOutputStyleRule(rulesyncRule: RulesyncRule): boolean {
    const frontmatter = rulesyncRule.getFrontmatter();
    return !frontmatter.root && frontmatter.factorydroid?.channel === "output-style";
  }

  /**
   * Factory Droid loads the channel files itself, so listing one in the root
   * rule's TOON reference section would double-load the content (and
   * misrepresent it as a rule the model must remember to open).
   */
  override isExcludedFromRootReferences(): boolean {
    return this.channel !== undefined;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<FactorydroidRule> {
    const paths = this.getSettablePaths({ global });

    if (this.isOutputStylePath({ relativeDirPath, relativeFilePath })) {
      const outputStylesDirPath = this.getOutputStylesDirPath();
      const fileContent = await readFileContent(
        join(outputRoot, outputStylesDirPath, relativeFilePath),
      );
      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: outputStylesDirPath,
        relativeFilePath,
        fileContent,
        validate,
        root: false,
        channel: "output-style",
      });
    }

    // Route a channel file to its own instance; everything else resolves
    // through the existing root/non-root handling.
    const channelMatch = this.findChannelByPath({ relativeDirPath, relativeFilePath, global });
    if (channelMatch) {
      const { channel, path } = channelMatch;
      const relativePath = join(path.relativeDirPath, path.relativeFilePath);
      const fileContent = await readFileContent(join(outputRoot, relativePath));

      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: path.relativeDirPath,
        relativeFilePath: path.relativeFilePath,
        fileContent,
        validate,
        root: false,
        channel,
      });
    }

    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = join(paths.root.relativeDirPath, paths.root.relativeFilePath);
      const fileContent = await readFileContent(join(outputRoot, relativePath));

      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));
    return new FactorydroidRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): FactorydroidRule {
    const paths = this.getSettablePaths({ global });
    const channel = this.isOutputStylePath({ relativeDirPath, relativeFilePath })
      ? "output-style"
      : this.findChannelByPath({ relativeDirPath, relativeFilePath, global })?.channel;
    const isRoot =
      channel === undefined &&
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath === paths.root.relativeDirPath;

    return new FactorydroidRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
      channel,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): FactorydroidRule {
    const frontmatter = rulesyncRule.getFrontmatter();
    const paths = this.getSettablePaths({ global });

    if (this.isOutputStyleRule(rulesyncRule)) {
      return this.buildOutputStyle({ outputRoot, rulesyncRule, validate });
    }

    // Opted-in non-root rules route to their channel file instead of
    // AGENTS.md / .factory/rules/*.md. Project scope only, matching
    // `getExtraFixedFiles`; the key is ignored elsewhere (folded normally).
    const requestedChannel = frontmatter.factorydroid?.channel;
    const channelMatch =
      !global && !frontmatter.root && requestedChannel !== undefined
        ? this.getChannelPaths({ global }).find(({ channel }) => channel === requestedChannel)
        : undefined;
    if (channelMatch) {
      const { channel, path } = channelMatch;
      return new FactorydroidRule({
        outputRoot,
        relativeDirPath: path.relativeDirPath,
        relativeFilePath: path.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: false,
        channel,
      });
    }

    return new FactorydroidRule(
      this.buildToolRuleParamsAgentsmd({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
        global,
      }),
    );
  }

  /**
   * Write an `output-style` rule as `.factory/output-styles/<name>.md`. The
   * file name is the rule's own, so a rule nested under `.rulesync/rules/`
   * is refused (Droid ignores nested files), as is a style named after a
   * built-in (`Default` / `Concise` "are reserved and cannot be replaced").
   */
  private static buildOutputStyle({
    outputRoot,
    rulesyncRule,
    validate,
  }: {
    outputRoot: string;
    rulesyncRule: RulesyncRule;
    validate: boolean;
  }): FactorydroidRule {
    const frontmatter = rulesyncRule.getFrontmatter();
    const sourcePath = rulesyncRule.getRelativeFilePath();
    if (basename(sourcePath) !== sourcePath) {
      throw new Error(
        `Rule '${sourcePath}' sets factorydroid.channel: output-style but is nested in a subdirectory: Factory Droid loads only direct .md children of .factory/output-styles/, so move it to the top of ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
      );
    }
    const stem = basename(sourcePath, extname(sourcePath));
    const name = frontmatter.factorydroid?.name;
    const styleName = name ?? stem;
    if (FACTORYDROID_RESERVED_OUTPUT_STYLE_NAMES.includes(styleName.trim().toLowerCase())) {
      throw new Error(
        `Rule '${sourcePath}' sets factorydroid.channel: output-style with the style name '${styleName}', which is reserved: Factory Droid's built-in Default and Concise styles cannot be replaced. Rename the rule file or set factorydroid.name.`,
      );
    }

    const styleFrontmatter = {
      ...(name !== undefined && { name }),
      ...(frontmatter.description !== undefined && { description: frontmatter.description }),
    };
    const body = rulesyncRule.getBody();
    return new FactorydroidRule({
      outputRoot,
      relativeDirPath: this.getOutputStylesDirPath(),
      relativeFilePath: `${stem}.md`,
      fileContent:
        Object.keys(styleFrontmatter).length > 0
          ? stringifyFrontmatter(body, styleFrontmatter)
          : body,
      validate,
      root: false,
      channel: "output-style",
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.channel === "output-style") {
      // The style's `name` / `description` frontmatter maps back onto the
      // rule's `factorydroid.name` / `description`, and the file keeps its
      // own name, so generate writes it back to the same path.
      const { frontmatter, body } = parseFrontmatter(
        this.getFileContent(),
        join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      );
      const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description : undefined;
      return new RulesyncRule({
        outputRoot: process.cwd(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: this.getRelativeFilePath(),
        frontmatter: {
          root: false,
          targets: ["factorydroid"],
          ...(description !== undefined && { description }),
          factorydroid: { channel: "output-style", ...(name !== undefined && { name }) },
        },
        body: body.trim(),
      });
    }
    if (this.channel !== undefined) {
      // Imported under the channel file's own basename (`DESIGN.md`,
      // `threat-model.md`) so the two channels never collide in
      // `.rulesync/rules/`.
      return new RulesyncRule({
        outputRoot: process.cwd(),
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: this.getRelativeFilePath(),
        frontmatter: {
          root: false,
          targets: ["factorydroid"],
          factorydroid: { channel: this.channel },
        },
        body: this.getFileContent(),
      });
    }
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "factorydroid",
    });
  }
}
