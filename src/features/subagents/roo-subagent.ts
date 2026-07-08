import { basename, join } from "node:path";

import { dump, load } from "js-yaml";
import { z } from "zod/mini";

import { ROO_MODES_FILE_NAME } from "../../constants/roo-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Default tool groups assigned to a generated mode when the rulesync source
 * does not specify a `roo.groups` override. Mirrors Roo's built-in code mode
 * (full read/edit/command/mcp access; browser is opt-in).
 */
const DEFAULT_GROUPS = ["read", "edit", "command", "mcp"] as const;

/**
 * One entry of a mode's `groups` array. Either a bare toolset name
 * (`"read"`, `"edit"`, `"command"`, `"mcp"`, `"browser"`) or a tuple pairing a
 * toolset (in practice `"edit"`) with a file restriction object.
 * @see https://roocodeinc.github.io/Roo-Code/features/custom-modes
 */
const RooModeGroupSchema = z.union([z.string(), z.tuple([z.string(), z.looseObject({})])]);

/**
 * A single custom mode inside the `customModes` array of `.roomodes`.
 * @see https://roocodeinc.github.io/Roo-Code/features/custom-modes
 */
const RooModeSchema = z.looseObject({
  slug: z.string(),
  name: z.string(),
  description: z.optional(z.string()),
  roleDefinition: z.string(),
  whenToUse: z.optional(z.string()),
  groups: z.optional(z.array(RooModeGroupSchema)),
  customInstructions: z.optional(z.string()),
});

export type RooMode = z.infer<typeof RooModeSchema>;

const RooModesFileSchema = z.looseObject({
  customModes: z.array(RooModeSchema),
});

export type RooSubagentParams = {
  modes: RooMode[];
} & Omit<AiFileParams, "fileContent">;

/**
 * Sanitize a string into a valid Roo mode slug (`^[a-zA-Z0-9-]+$`): lowercase,
 * non-alphanumeric runs collapsed to a single hyphen, leading/trailing hyphens
 * trimmed. Falls back to `"mode"` if nothing usable remains.
 */
export function sanitizeRooSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "mode";
}

function stringifyRooModes(modes: RooMode[]): string {
  return dump({ customModes: modes }, { lineWidth: -1, noRefs: true });
}

/**
 * Roo Code custom-modes adapter.
 *
 * Roo reads project-level custom modes from a single aggregated `.roomodes`
 * file at the workspace root (`docs.roocode.com` 301-redirects to the docs
 * below). Each rulesync subagent becomes one entry in the `customModes` array.
 * Because the native format aggregates N subagents into ONE file, every
 * `RooSubagent` instance carries the FULL `customModes` array and targets the
 * same `.roomodes` path; generation builds the aggregate once via
 * {@link RooSubagent.fromRulesyncSubagents}.
 *
 * @see https://roocodeinc.github.io/Roo-Code/features/custom-modes
 */
export class RooSubagent extends ToolSubagent {
  private readonly modes: RooMode[];

  constructor({ modes, ...rest }: RooSubagentParams) {
    if (rest.validate !== false) {
      const result = RooModesFileSchema.safeParse({ customModes: modes });
      if (!result.success) {
        throw new Error(
          `Invalid .roomodes in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyRooModes(modes),
    });

    this.modes = modes;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: ".",
    };
  }

  getModes(): RooMode[] {
    return this.modes;
  }

  getBody(): string {
    return this.fileContent;
  }

  /**
   * Map a single rulesync subagent to a Roo custom mode. The body becomes
   * `roleDefinition`; the optional `roo:` frontmatter section supplies
   * `groups`, `whenToUse`, `customInstructions`, an explicit `slug`, and may
   * override `roleDefinition`. rulesync `name`/`description` are preferred,
   * while tool-specific `roo:` values take precedence where defined.
   */
  static toRooMode(rulesyncSubagent: RulesyncSubagent): RooMode {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection = (frontmatter.roo ?? {}) as Record<string, unknown>;

    const slug =
      typeof rawSection.slug === "string" && rawSection.slug.length > 0
        ? sanitizeRooSlug(rawSection.slug)
        : sanitizeRooSlug(basename(rulesyncSubagent.getRelativeFilePath()).replace(/\.[^.]+$/, ""));

    const roleDefinition =
      typeof rawSection.roleDefinition === "string"
        ? rawSection.roleDefinition
        : rulesyncSubagent.getBody();

    const groups = Array.isArray(rawSection.groups)
      ? (rawSection.groups as RooMode["groups"])
      : [...DEFAULT_GROUPS];

    const mode: RooMode = {
      slug,
      name: frontmatter.name,
      roleDefinition,
      groups,
    };

    if (frontmatter.description) {
      mode.description = frontmatter.description;
    }
    if (typeof rawSection.whenToUse === "string") {
      mode.whenToUse = rawSection.whenToUse;
    }
    if (typeof rawSection.customInstructions === "string") {
      mode.customInstructions = rawSection.customInstructions;
    }

    return mode;
  }

  /**
   * Aggregate every targeted rulesync subagent into a single `.roomodes` file.
   * Modes are de-duplicated by `slug` (last one wins) to keep the array unique.
   */
  static fromRulesyncSubagents({
    outputRoot = process.cwd(),
    rulesyncSubagents,
    validate = true,
  }: {
    outputRoot?: string;
    rulesyncSubagents: RulesyncSubagent[];
    validate?: boolean;
  }): RooSubagent {
    const bySlug = new Map<string, RooMode>();
    for (const rulesyncSubagent of rulesyncSubagents) {
      const mode = this.toRooMode(rulesyncSubagent);
      bySlug.set(mode.slug, mode);
    }

    return new RooSubagent({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: ROO_MODES_FILE_NAME,
      modes: [...bySlug.values()],
      validate,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
  }: ToolSubagentFromRulesyncSubagentParams): RooSubagent {
    return this.fromRulesyncSubagents({
      outputRoot,
      rulesyncSubagents: [rulesyncSubagent],
      validate,
    });
  }

  /**
   * Convert every custom mode in the aggregated `.roomodes` file back into an
   * individual rulesync subagent. The processor calls this in the import
   * direction (one `.roomodes` tool file fans out to N rulesync files).
   */
  toRulesyncSubagents(): RulesyncSubagent[] {
    return this.modes.map((mode) => {
      const {
        slug,
        name,
        description,
        roleDefinition,
        whenToUse,
        groups,
        customInstructions,
        ...rest
      } = mode;

      const rooSection: Record<string, unknown> = {
        ...rest,
        slug,
        ...(groups ? { groups } : {}),
        ...(whenToUse !== undefined ? { whenToUse } : {}),
        ...(customInstructions !== undefined ? { customInstructions } : {}),
      };

      const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
        targets: ["roo"],
        name,
        ...(description !== undefined ? { description } : {}),
        roo: rooSection,
      };

      return new RulesyncSubagent({
        outputRoot: ".",
        frontmatter: rulesyncFrontmatter,
        body: roleDefinition,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        // Re-sanitize the imported slug before using it as a filename so a
        // crafted `.roomodes` cannot produce a traversing path (defense in depth
        // on top of the central path-traversal guard).
        relativeFilePath: `${sanitizeRooSlug(slug)}.md`,
        validate: true,
      });
    });
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const subagents = this.toRulesyncSubagents();
    const first = subagents[0];
    if (!first) {
      throw new Error("No custom modes found in .roomodes to convert.");
    }
    return first;
  }

  validate(): ValidationResult {
    const result = RooModesFileSchema.safeParse({ customModes: this.modes });
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid .roomodes in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "roo",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolSubagentFromFileParams): Promise<RooSubagent> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    let parsed: unknown;
    try {
      parsed = load(fileContent);
    } catch (error) {
      throw new Error(`Failed to parse .roomodes (${filePath}): ${formatError(error)}`, {
        cause: error,
      });
    }

    const result = RooModesFileSchema.safeParse(parsed ?? { customModes: [] });
    if (!result.success) {
      throw new Error(`Invalid .roomodes in ${filePath}: ${formatError(result.error)}`);
    }

    return new RooSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      modes: result.data.customModes,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): RooSubagent {
    return new RooSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      modes: [],
      validate: false,
    });
  }
}
