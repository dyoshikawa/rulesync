import { join } from "node:path";

import { z } from "zod/mini";

import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { type ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  type RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { getGlobsStaticPrefix } from "../../utils/glob-static-prefix.js";
import { warnOnceWithFallback } from "../../utils/logger.js";

/**
 * The `agentsmd.subprojectPath` value that asks for the path to be derived from
 * the rule's `globs` (see {@link resolveSubprojectPath}). It is a request, not a
 * path: the constructor replaces it with the derived directory, or drops it,
 * before any consumer reads the frontmatter.
 */
export const AUTO_SUBPROJECT_PATH = "auto";

export const RulesyncRuleFrontmatterSchema = z.object({
  root: z.optional(z.boolean()),
  localRoot: z.optional(z.boolean()),
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  description: z.optional(z.string()),
  globs: z.optional(z.array(z.string())),
  agentsmd: z.optional(
    z.looseObject({
      // The directory whose nested `AGENTS.md` this non-root rule becomes, or
      // "auto" to derive it from `globs` (`["packages/api/**/*"]` → `packages/api`)
      // for this rule alone, regardless of the `deriveSubprojectPathFromGlobs`
      // config option. An explicit "" keeps the rule at its default placement
      // even when that option is on. `getFrontmatter()` only ever carries the
      // resolved directory; `getAuthoredFrontmatter()` keeps what was written.
      // @example "path/to/subproject"
      subprojectPath: z.optional(z.string()),
    }),
  ),
  claudecode: z.optional(
    z.looseObject({
      // Glob patterns for conditional rules (takes precedence over globs)
      // @example ["src/**/*.ts", "tests/**/*.test.ts"]
      paths: z.optional(z.array(z.string())),
    }),
  ),
  cursor: z.optional(
    z.looseObject({
      alwaysApply: z.optional(z.boolean()),
      description: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
    }),
  ),
  copilot: z.optional(
    z.looseObject({
      // `cloud-agent` is the current documented value; `coding-agent` is a deprecated alias.
      excludeAgent: z.optional(
        z.union([z.literal("code-review"), z.literal("cloud-agent"), z.literal("coding-agent")]),
      ),
      // Display name shown in the VS Code UI for an `*.instructions.md` file.
      // https://code.visualstudio.com/docs/agent-customization/custom-instructions
      name: z.optional(z.string()),
    }),
  ),
  antigravity: z.optional(
    z.looseObject({
      trigger: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
    }),
  ),
  devin: z.optional(
    z.looseObject({
      // Activation mode: always_on | glob | manual | model_decision
      trigger: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
      description: z.optional(z.string()),
    }),
  ),
  augmentcode: z.optional(
    z.looseObject({
      type: z.optional(z.string()),
      description: z.optional(z.string()),
    }),
  ),
  kiro: z.optional(
    z.looseObject({
      // Steering inclusion mode: always | fileMatch | manual | auto (string for forward compat).
      inclusion: z.optional(z.string()),
      // Glob(s) used when `inclusion: fileMatch`. Kiro accepts a single string or
      // a YAML array of globs.
      fileMatchPattern: z.optional(z.union([z.string(), z.array(z.string())])),
      // Companion fields required by `inclusion: auto`: Kiro auto-includes the
      // steering file when a request matches `description` (skill-like), keyed by `name`.
      name: z.optional(z.string()),
      description: z.optional(z.string()),
    }),
  ),
  pi: z.optional(
    z.looseObject({
      // Route this rule's body to Pi's *append* system-prompt file
      // (`.pi/APPEND_SYSTEM.md`, global `~/.pi/agent/APPEND_SYSTEM.md`) instead of
      // folding it into `AGENTS.md`. Only "append" is supported: Pi's other
      // system-prompt file, `SYSTEM.md`, *replaces* the built-in system prompt
      // entirely (silently disabling Pi's own tool instructions), which is a
      // hazard rulesync deliberately does not emit and leaves hand-authored.
      // See docs/reference/file-formats.md.
      systemPrompt: z.optional(z.enum(["append"])),
      // Emit the root context file as `AGENTS.override.md` instead of
      // `AGENTS.md`. Pi tries `AGENTS.override.md` first in every directory it
      // scans, so it deterministically wins over a sibling `AGENTS.md` or
      // `CLAUDE.md` written by another target. Set it on the `root: true` rule:
      // the root decides for the whole Pi output, and the flag on a non-root
      // rule alone is ignored with a warning (folded bodies must land in the
      // file Pi actually reads).
      contextFile: z.optional(z.enum(["override"])),
    }),
  ),
  roo: z.optional(
    z.looseObject({
      // Route this rule to a mode-specific directory (`.roo/rules-{mode}/`,
      // global `~/.roo/rules-{mode}/`) instead of the mode-agnostic
      // `.roo/rules/`. Roo Code and Zoo Code load a mode's directory INSTEAD of
      // the generic one while that mode is active, so this is how a rule is
      // scoped to a single custom mode. Shared by the `roo` and `zoocode`
      // targets, which write the same `.roo/` tree.
      // https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/core/prompts/sections/custom-instructions.ts
      mode: z.optional(z.string()),
    }),
  ),
  takt: z.optional(
    z.looseObject({
      // Rename the emitted file stem (e.g. "coder.md" → "{name}.md").
      name: z.optional(z.string()),
      // Facet inheritance: emit a leading `{extends:<parent>}` directive (Takt 0.39.0+).
      // Rules map to the `policies` facet, which supports inheritance.
      extends: z.optional(z.string()),
      // Redirect the rule to a different writable Takt facet. Rules default to the
      // `policies` facet; set `facet: "output-contracts"` to author an output-contract
      // facet (output structure / report templates) instead. Both facets support
      // `{extends:...}` inheritance. See docs/reference/file-formats.md.
      facet: z.optional(z.enum(["policies", "output-contracts"])),
    }),
  ),
});

// Input type allows targets to be omitted (will use default value)
export type RulesyncRuleFrontmatterInput = z.input<typeof RulesyncRuleFrontmatterSchema>;
// Output type has targets always present after parsing
export type RulesyncRuleFrontmatter = z.infer<typeof RulesyncRuleFrontmatterSchema>;

export type RulesyncRuleParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncRuleFrontmatterInput;
  body: string;
  /**
   * Derive `agentsmd.subprojectPath` from `globs` for every non-root rule that
   * does not set one explicitly (the `deriveSubprojectPathFromGlobs` config
   * option). A rule can ask for the same on its own with
   * `agentsmd.subprojectPath: "auto"`.
   */
  deriveSubprojectPathFromGlobs?: boolean;
};

export type RulesyncRuleFromFileParams = RulesyncFileFromFileParams & {
  deriveSubprojectPathFromGlobs?: boolean;
};

/**
 * The `agentsmd.subprojectPath` every consumer should act on, resolved once so
 * that no target has to know how it came about:
 *
 * 1. an explicit directory in the frontmatter wins, and an explicit `""` is an
 *    opt-out: the rule keeps its default placement and nothing is derived;
 * 2. otherwise, when the rule says `"auto"` or `deriveFromGlobs` is on, the
 *    directory the rule's `globs` share (see `getGlobsStaticPrefix`);
 * 3. otherwise none, which keeps the rule in the target's modular directory.
 *
 * A root rule never nests, so it never derives. When a derivation yields
 * nothing the rule falls back to step 3, and only a rule that asked with
 * `"auto"` is told, once: it named a placement it did not get, so a warning
 * names the file to fix (an error would stop every other rule from
 * generating). The config option applies to every non-root rule, most of
 * which are general guidance whose globs, if any, were written as activation
 * hints (`["src/**\/*.ts", "test/**\/*.ts"]`) rather than as a directory;
 * warning about each of those on every generate would drown out real ones,
 * so config-driven derivation falls back silently.
 */
function resolveSubprojectPath({
  frontmatter,
  deriveFromGlobs,
  rulePath,
}: {
  frontmatter: RulesyncRuleFrontmatter;
  deriveFromGlobs: boolean;
  rulePath: string;
}): string | undefined {
  const authored = frontmatter.agentsmd?.subprojectPath;
  if (authored === "") {
    return undefined;
  }
  if (typeof authored === "string" && authored !== AUTO_SUBPROJECT_PATH) {
    return authored;
  }
  const requested = authored === AUTO_SUBPROJECT_PATH;
  if (!requested && !deriveFromGlobs) {
    return undefined;
  }
  if (frontmatter.root) {
    if (requested) {
      warnOnceWithFallback(
        undefined,
        `Ignoring agentsmd.subprojectPath: "${AUTO_SUBPROJECT_PATH}" on the root rule ${rulePath}: a root rule is never written as a nested AGENTS.md.`,
      );
    }
    return undefined;
  }

  const globs = Array.isArray(frontmatter.globs) ? frontmatter.globs : [];
  const derived = getGlobsStaticPrefix(globs);
  if (derived === undefined && requested) {
    warnOnceWithFallback(
      undefined,
      `Could not derive agentsmd.subprojectPath for ${rulePath} from globs ${JSON.stringify(globs)}: every glob must start with the same wildcard-free directory (e.g. "packages/api/**/*"). The rule is generated without a nested AGENTS.md; set agentsmd.subprojectPath explicitly to nest it.`,
    );
  }
  return derived;
}

/**
 * `frontmatter` with `agentsmd.subprojectPath` replaced by its resolved value,
 * or removed when there is none, so the `"auto"` request never reaches a
 * consumer as if it were a directory name. An `agentsmd` block that held
 * nothing but the request goes with it, so a consumer sees the same shape it
 * would for a rule that never mentioned `agentsmd`. An authored `""` is left
 * as written: every consumer already reads it as "no nesting".
 */
function withResolvedSubprojectPath({
  frontmatter,
  deriveFromGlobs,
  rulePath,
}: {
  frontmatter: RulesyncRuleFrontmatter;
  deriveFromGlobs: boolean;
  rulePath: string;
}): RulesyncRuleFrontmatter {
  const authored = frontmatter.agentsmd?.subprojectPath;
  const resolved = resolveSubprojectPath({ frontmatter, deriveFromGlobs, rulePath });
  if (resolved === authored || (resolved === undefined && authored !== AUTO_SUBPROJECT_PATH)) {
    return frontmatter;
  }
  const { subprojectPath: _authored, ...agentsmd } = frontmatter.agentsmd ?? {};
  if (resolved !== undefined) {
    return { ...frontmatter, agentsmd: { ...agentsmd, subprojectPath: resolved } };
  }
  if (Object.keys(agentsmd).length === 0) {
    const { agentsmd: _empty, ...rest } = frontmatter;
    return rest;
  }
  return { ...frontmatter, agentsmd };
}

export type RulesyncRuleSettablePaths = {
  recommended: {
    relativeDirPath: string;
  };
  legacy: {
    relativeDirPath: string;
  };
};

export class RulesyncRule extends RulesyncFile {
  /**
   * The frontmatter consumers read. It differs from what the file says in one
   * place: `agentsmd.subprojectPath` holds the resolved directory (see
   * `resolveSubprojectPath`), while `authoredFrontmatter` and
   * `getFileContent()` keep the authored value, so a rule written back out
   * still says `"auto"`.
   */
  private readonly frontmatter: RulesyncRuleFrontmatter;
  /**
   * The frontmatter as written, after schema defaults but before
   * `agentsmd.subprojectPath` resolution: what `getFileContent()` serializes.
   */
  private readonly authoredFrontmatter: RulesyncRuleFrontmatter;
  private readonly body: string;

  constructor({
    frontmatter,
    body,
    deriveSubprojectPathFromGlobs = false,
    ...rest
  }: RulesyncRuleParams) {
    // Parse frontmatter to apply defaults and validate
    const parseResult = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`,
      );
    }
    // Apply defaults manually when validation is disabled but parsing failed
    const parsedFrontmatter: RulesyncRuleFrontmatter = parseResult.success
      ? parseResult.data
      : { ...frontmatter, targets: frontmatter.targets ?? ["*"] };

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter),
    });

    this.authoredFrontmatter = parsedFrontmatter;
    this.frontmatter = withResolvedSubprojectPath({
      frontmatter: parsedFrontmatter,
      deriveFromGlobs: deriveSubprojectPathFromGlobs,
      rulePath: join(rest.relativeDirPath, rest.relativeFilePath),
    });
    this.body = body;
  }

  static getSettablePaths(): RulesyncRuleSettablePaths {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      },
    };
  }

  /**
   * The frontmatter to act on: `agentsmd.subprojectPath` is the resolved
   * placement, never `"auto"`.
   */
  getFrontmatter(): RulesyncRuleFrontmatter {
    return this.frontmatter;
  }

  /**
   * The frontmatter as the file states it, `agentsmd.subprojectPath: "auto"`
   * included. This is the view to hand back to whoever edits the file (the
   * MCP rule tools): returning the resolved placement instead would make a
   * get → edit → put round trip hardcode the derived directory, or drop the
   * request when nothing could be derived.
   */
  getAuthoredFrontmatter(): RulesyncRuleFrontmatter {
    return this.authoredFrontmatter;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncRuleFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    deriveSubprojectPathFromGlobs = false,
  }: RulesyncRuleFromFileParams): Promise<RulesyncRule> {
    // `relativeDirPath` overrides the class-level default when the caller
    // (a processor loading from a non-default source tree such as
    // `.rulesync.local/rules`) needs to point at a tree whose basename
    // differs from `.rulesync`. See the `inputRoots` design note.
    const dirPath = relativeDirPath ?? this.getSettablePaths().recommended.relativeDirPath;
    const filePath = join(outputRoot, dirPath, relativeFilePath);

    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content, hasFrontmatter } = parseFrontmatter(fileContent, filePath);

    // Check that the file actually contains a YAML frontmatter block.
    // Without this check, a file without frontmatter would be silently accepted
    // with default values (targets: ["*"], root: false, etc.), which is almost
    // certainly not what the user intended. See issue #316.
    if (!hasFrontmatter) {
      throw new Error(
        `Missing frontmatter in ${filePath}. Rulesync files must begin with a YAML frontmatter block delimited by '---'.`,
      );
    }

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    const validatedFrontmatter: RulesyncRuleFrontmatter = {
      ...result.data,
      root: result.data.root ?? false,
      localRoot: result.data.localRoot ?? false,
      globs: result.data.globs ?? [],
    };

    return new RulesyncRule({
      outputRoot,
      relativeDirPath: dirPath,
      relativeFilePath,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
      validate,
      deriveSubprojectPathFromGlobs,
    });
  }

  getBody(): string {
    return this.body;
  }
}
