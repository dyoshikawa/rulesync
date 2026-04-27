import path, { join, relative, resolve } from "node:path";

import { ValidationResult } from "../../types/ai-dir.js";
import { toPosixPath } from "../../utils/file.js";
import { assertSafeTaktName } from "../takt-shared.js";
import { RulesyncSkill, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Fixed facet directory for TAKT skill files.
 *
 * Rulesync skills map one-to-one to TAKT's `knowledge/` facet. No override
 * is supported; the directory is always `.takt/facets/knowledge/`.
 */
export const DEFAULT_TAKT_SKILL_DIR = "knowledge";

export type TaktSkillParams = {
  outputRoot?: string;
  relativeDirPath: string;
  dirName: string;
  /** File name (with `.md` extension) to emit under `relativeDirPath`. */
  fileName: string;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Skill generator for TAKT.
 *
 * Unlike most other tools, TAKT skills are emitted as flat Markdown files
 * (one `.md` per skill) under `.takt/facets/knowledge/`. The facet directory
 * is fixed — no `takt.facet` override is supported.
 *
 * To remain compatible with the directory-based `AiDir` abstraction this
 * class still tracks a `dirName` (used for routing and deletion), but
 * `getDirPath()` is overridden to drop the trailing directory segment so
 * that the emitted main file lands directly under the facet directory:
 *
 *   `.takt/facets/knowledge/{stem}.md`
 *
 * The original frontmatter is dropped — only the body is written verbatim.
 */
export class TaktSkill extends ToolSkill {
  private readonly fileName: string;

  constructor({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    fileName,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: TaktSkillParams) {
    super({
      outputRoot,
      relativeDirPath,
      dirName,
      mainFile: {
        name: fileName,
        body,
        // Frontmatter is intentionally undefined — TAKT files are plain Markdown.
        frontmatter: undefined,
      },
      otherFiles,
      global,
    });
    this.fileName = fileName;

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: join(".takt", "facets", DEFAULT_TAKT_SKILL_DIR),
    };
  }

  /**
   * Override: TAKT skills emit a single flat file under `relativeDirPath`,
   * not a nested directory keyed by `dirName`. Drop `dirName` from the path.
   *
   * Preserves the same path-traversal guard as `AiDir.getDirPath` so a
   * malicious `relativeDirPath` cannot escape `outputRoot`.
   */
  override getDirPath(): string {
    const fullPath = join(this.outputRoot, this.relativeDirPath);

    const resolvedFull = resolve(fullPath);
    const resolvedBase = resolve(this.outputRoot);
    const rel = relative(resolvedBase, resolvedFull);

    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes outputRoot. ` +
          `outputRoot="${this.outputRoot}", relativeDirPath="${this.relativeDirPath}"`,
      );
    }

    return fullPath;
  }

  override getRelativePathFromCwd(): string {
    return toPosixPath(this.relativeDirPath);
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  getFileName(): string {
    return this.fileName;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    // Reverse-mapping from the flat TAKT layout into a directory-based
    // `RulesyncSkill` cannot recover the original `description` metadata
    // (TAKT files are plain Markdown). Fail loudly rather than silently
    // emit a synthetic stub.
    throw new Error(
      "Importing existing TAKT facet files into rulesync is not supported: " +
        "TAKT files are plain Markdown and the original skill metadata cannot be recovered.",
    );
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): TaktSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const taktSection = rulesyncFrontmatter.takt;
    const sourceLabel = rulesyncSkill.getDirName();

    const overrideName = typeof taktSection?.name === "string" ? taktSection.name : undefined;
    const stem = overrideName ?? rulesyncSkill.getDirName();
    assertSafeTaktName({ name: stem, featureLabel: "skill", sourceLabel });
    const fileName = `${stem}.md`;

    const relativeDirPath = join(".takt", "facets", DEFAULT_TAKT_SKILL_DIR);

    return new TaktSkill({
      outputRoot,
      relativeDirPath,
      dirName: stem,
      fileName,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("takt");
  }

  /**
   * Importing existing TAKT facet files into rulesync is not supported.
   *
   * TAKT emits flat plain-Markdown files (no `SKILL.md` directory layout, no
   * frontmatter). The reverse import would have to invent a skill name and
   * description out of the file stem alone, which silently produces a stub
   * that round-trips badly. Throwing makes the limitation explicit at the
   * call site rather than letting bad data sneak through.
   */
  static async fromDir(_params: ToolSkillFromDirParams): Promise<TaktSkill> {
    throw new Error(
      "Importing existing TAKT facet files into rulesync is not supported: " +
        "TAKT files are plain Markdown and the original skill metadata cannot be recovered.",
    );
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): TaktSkill {
    return new TaktSkill({
      outputRoot,
      relativeDirPath,
      dirName,
      fileName: `${dirName}.md`,
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
