import { basename, join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  TAKT_CONFIG_FILE_NAME,
  TAKT_DIR,
  TAKT_WORKFLOW_OVERRIDES_KEY,
} from "../../constants/takt-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  TAKT_CONFIG_SHARED_FILE_KEY,
} from "../shared/shared-config-gateway.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
  type ToolCheckSettablePaths,
} from "./tool-check.js";

/**
 * The `type: command` gate shape Takt accepts inside `quality_gates`. Mirrors
 * upstream's `CommandQualityGateInputSchema`, which is `.strict()` — an unknown
 * key there fails Takt's own config load, so the schema is closed here too.
 *
 * @see https://github.com/nrslib/takt/blob/main/src/core/models/schema-base.ts
 */
const TaktCommandGateSchema = z.object({
  command: z.string().check(z.minLength(1)),
  name: z.optional(z.string().check(z.minLength(1))),
  cwd: z.optional(z.string().check(z.minLength(1))),
  timeout_ms: z.optional(z.number().check(z.positive(), z.int())),
});

/**
 * The `takt` block of a check's frontmatter. Everything here is optional: a
 * check with no block at all becomes a plain string gate.
 */
const TaktCheckOverrideSchema = z.looseObject({
  ...TaktCommandGateSchema.def.shape,
  command: z.optional(z.string().check(z.minLength(1))),
  /** Workflow step names this gate applies to; omitted means every step. */
  steps: z.optional(z.array(z.string().check(z.minLength(1)))),
  /** Persona names this gate applies to; omitted means every persona. */
  personas: z.optional(z.array(z.string().check(z.minLength(1)))),
  /** Block-level: run gates only on steps that may edit files. */
  quality_gates_edit_only: z.optional(z.boolean()),
});

type TaktCheckOverride = z.infer<typeof TaktCheckOverrideSchema>;

/** A `quality_gates` entry: an AI completion directive, or a command gate. */
type TaktQualityGate = string | Record<string, unknown>;

function parseOverride(raw: unknown, filePath: string): TaktCheckOverride {
  if (!isPlainObject(raw)) {
    return {};
  }
  const result = TaktCheckOverrideSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid \`takt\` block in ${filePath}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Build the gate a single check contributes. A `command` in the `takt` block
 * makes it a command gate — Takt runs the command after the agent step and
 * fails the gate on a non-zero exit — otherwise the check body is the directive
 * text injected into the step prompt.
 */
function toQualityGate(rulesyncCheck: RulesyncCheck, override: TaktCheckOverride): TaktQualityGate {
  if (override.command !== undefined) {
    return {
      type: "command",
      // Takt's own logs identify a gate by `name`, so fall back to the check's
      // file stem rather than leaving it unnamed.
      name: override.name ?? stemOf(rulesyncCheck),
      command: override.command,
      ...(override.cwd !== undefined && { cwd: override.cwd }),
      ...(override.timeout_ms !== undefined && { timeout_ms: override.timeout_ms }),
    };
  }
  const body = rulesyncCheck.getBody().trim();
  const description = rulesyncCheck.getFrontmatter().description?.trim();
  // A gate is one directive string. The body is the authored text; the
  // description is a summary, used only when there is no body to inject.
  return body.length > 0 ? body : (description ?? stemOf(rulesyncCheck));
}

function stemOf(rulesyncCheck: RulesyncCheck): string {
  // basename, so a check in a subdirectory does not name its gate `dir/name`.
  return basename(rulesyncCheck.getRelativeFilePath(), ".md");
}

/**
 * Group the gates by where they belong in `workflow_overrides`: unscoped gates
 * at the top level, and step/persona-scoped ones under their own keys. Takt
 * merges the three additively (project > global > workflow YAML) and dedupes,
 * so a gate naming both a step and a persona is written to both.
 */
function buildWorkflowOverrides(
  entries: { gate: TaktQualityGate; override: TaktCheckOverride }[],
): Record<string, unknown> {
  const topLevel: TaktQualityGate[] = [];
  // Null-prototype: a step literally named `__proto__` would otherwise resolve
  // to `Object.prototype` and make the `??=` below skip its own assignment.
  const steps: Record<string, TaktQualityGate[]> = Object.create(null);
  const personas: Record<string, TaktQualityGate[]> = Object.create(null);

  for (const { gate, override } of entries) {
    const scopedSteps = override.steps ?? [];
    const scopedPersonas = override.personas ?? [];
    if (scopedSteps.length === 0 && scopedPersonas.length === 0) {
      topLevel.push(gate);
      continue;
    }
    for (const step of scopedSteps) {
      (steps[step] ??= []).push(gate);
    }
    for (const persona of scopedPersonas) {
      (personas[persona] ??= []).push(gate);
    }
  }

  // `quality_gates_edit_only` is a property of the whole block, not of one gate,
  // so any check asking for it turns it on for all of them.
  const editOnly = entries.some(({ override }) => override.quality_gates_edit_only === true);

  return {
    ...(topLevel.length > 0 && { quality_gates: topLevel }),
    ...(editOnly && { quality_gates_edit_only: true }),
    ...(Object.keys(steps).length > 0 && { steps: toScopedBlock(steps) }),
    ...(Object.keys(personas).length > 0 && { personas: toScopedBlock(personas) }),
  };
}

function toScopedBlock(grouped: Record<string, TaktQualityGate[]>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(grouped)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, gates]) => [name, { quality_gates: gates }]),
  );
}

/** Turn a gate back into the check it was generated from. */
function toRulesyncCheckFromGate({
  gate,
  index,
  scope,
  editOnly,
}: {
  gate: TaktQualityGate;
  index: number;
  scope?: { key: "steps" | "personas"; name: string };
  editOnly: boolean;
}): RulesyncCheck | undefined {
  // `quality_gates_edit_only` is block-level on the Takt side, so it is restored
  // onto every check: generate turns it on when *any* check asks for it, which
  // round-trips the block back to the same value.
  const scopeOverride = {
    ...(scope && { [scope.key]: [scope.name] }),
    ...(editOnly && { quality_gates_edit_only: true }),
  };

  if (typeof gate === "string") {
    return new RulesyncCheck({
      outputRoot: ".",
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: `${slugForGate({ gate, index, scope })}.md`,
      frontmatter: {
        targets: ["takt"],
        ...(Object.keys(scopeOverride).length > 0 && { takt: scopeOverride }),
      },
      body: gate,
    });
  }

  if (!isPlainObject(gate) || gate.type !== "command" || typeof gate.command !== "string") {
    // Not a shape Takt itself accepts; leave it in config.yaml untouched rather
    // than inventing a check for it.
    return undefined;
  }

  const { type: _type, ...rest } = gate;
  // A hand-edited gate can carry a field of the wrong type. Importing it would
  // write a check the next generate refuses to convert, taking the whole
  // generate down, so the gate stays in config.yaml instead.
  const commandResult = TaktCommandGateSchema.safeParse(rest);
  if (!commandResult.success) {
    return undefined;
  }
  const commandFields = commandResult.data;
  return new RulesyncCheck({
    outputRoot: ".",
    relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
    relativeFilePath: `${slugForGate({ gate, index, scope })}.md`,
    frontmatter: {
      targets: ["takt"],
      takt: { ...commandFields, ...scopeOverride },
    },
    body: "",
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function slugForGate({
  gate,
  index,
  scope,
}: {
  gate: TaktQualityGate;
  index: number;
  scope?: { key: "steps" | "personas"; name: string };
}): string {
  const source =
    typeof gate === "string"
      ? gate
      : typeof gate.name === "string"
        ? gate.name
        : typeof gate.command === "string"
          ? gate.command
          : "";
  const slug = slugify(source);
  // The scope name comes from someone else's config.yaml on import, so it goes
  // through the same slug rules as the gate text: a raw `feature/review` would
  // write a nested file the loader (a flat listing) never reads back.
  const prefix = scope ? `${slugify(scope.name)}-` : "";
  // The index keeps two gates that slugify the same from overwriting each other.
  return `${prefix}${slug.length > 0 ? slug : "quality-gate"}-${index + 1}`;
}

/**
 * Checks adapter for Takt (`.takt/config.yaml` project / `~/.takt/config.yaml`
 * global).
 *
 * Takt calls these **quality gates**. They live in the `workflow_overrides`
 * block of the shared config rather than in files of their own, so every
 * `.rulesync/checks/*.md` targeting Takt collapses into one output file — hence
 * {@link fromRulesyncChecks} rather than the usual per-check conversion.
 *
 * A check becomes one gate:
 *   - by default a **string gate**, the body text, which Takt injects into the
 *     agent step prompt as a completion directive;
 *   - with `command` in the check's `takt` frontmatter block, a **command
 *     gate** (`{type: command, name, command, cwd, timeout_ms}`), which Takt
 *     runs after the step and fails on a non-zero exit code.
 *
 * `steps` / `personas` in that block scope a gate to named workflow steps or
 * personas (`workflow_overrides.steps.<step>.quality_gates`); an unscoped gate
 * applies everywhere. `quality_gates_edit_only` is a property of the block as a
 * whole, so one check setting it turns it on for all of them.
 *
 * `workflow_command_gates.custom_scripts` — the default-deny policy that admits
 * command gates declared in *workflow YAML* — is deliberately not written here.
 * Takt validates it against workflow-declared gates only, and it is authorable
 * through the `takt` block of `.rulesync/permissions.*`, which owns the security
 * policies.
 *
 * `workflow_overrides` is owned by this feature in the shared config: it is
 * rewritten from `.rulesync/checks/` on every generate, while every other key of
 * `config.yaml` is preserved and the file is never deleted.
 *
 * @see https://github.com/nrslib/takt/blob/main/docs/workflows.md
 */
export class TaktCheck extends ToolCheck {
  override isDeletable(): boolean {
    // config.yaml holds the rest of Takt's settings.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // The directory drives the processor's import glob; naming the file keeps
    // consumers that would otherwise claim the whole `.takt/` tree — which the
    // user fills with workflows and facets — narrowed to the one file written.
    return { relativeDirPath: TAKT_DIR, relativeFilePath: TAKT_CONFIG_FILE_NAME };
  }

  /**
   * `config.yaml` is written by the MCP and permissions features too, so it has
   * to appear in the shared-write ordering even though `getSettablePaths` names
   * only the directory.
   */
  static getExtraSharedWritePaths(_options: { global?: boolean } = {}): {
    relativeDirPath: string;
    relativeFilePath: string;
  }[] {
    return [{ relativeDirPath: TAKT_DIR, relativeFilePath: TAKT_CONFIG_FILE_NAME }];
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({ rulesyncCheck, toolTarget: "takt" });
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): TaktCheck {
    // Gates share one file, so they are only ever built as a set.
    throw new Error("Takt checks are built from all checks at once; use fromRulesyncChecks.");
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
  }: ToolCheckFromRulesyncChecksParams): Promise<TaktCheck[]> {
    const paths = TaktCheck.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, TAKT_CONFIG_FILE_NAME);
    // Read without initializing so a dry-run does not create the user's
    // config.yaml as a side effect (mirrors the Takt MCP/permissions adapters).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    if (rulesyncChecks.length === 0) {
      // Checks exist but none of them name Takt, so this run has nothing to say
      // about its gates. Writing an empty block would create a config.yaml for a
      // project that has none, and wipe gates the user wrote by hand.
      return [];
    }

    const entries = rulesyncChecks.map((rulesyncCheck) => {
      const override = parseOverride(
        rulesyncCheck.getFrontmatter().takt,
        join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, rulesyncCheck.getRelativeFilePath()),
      );
      return { gate: toQualityGate(rulesyncCheck, override), override };
    });

    return [
      new TaktCheck({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: TAKT_CONFIG_FILE_NAME,
        fileContent: applySharedConfigPatch({
          fileKey: TAKT_CONFIG_SHARED_FILE_KEY,
          feature: "checks",
          existingContent,
          patch: { [TAKT_WORKFLOW_OVERRIDES_KEY]: buildWorkflowOverrides(entries) },
          filePath,
        }),
        global,
      }),
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<TaktCheck> {
    const paths = TaktCheck.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, TAKT_CONFIG_FILE_NAME);
    return new TaktCheck({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: TAKT_CONFIG_FILE_NAME,
      fileContent: (await readFileContentOrNull(filePath)) ?? "",
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCheckForDeletionParams): TaktCheck {
    return new TaktCheck({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncCheck(): RulesyncCheck {
    const checks = this.toRulesyncChecks();
    const first = checks[0];
    if (!first) {
      throw new Error(
        `No quality gates found in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}.`,
      );
    }
    return first;
  }

  override toRulesyncChecks(): RulesyncCheck[] {
    const config = parseSharedConfig({
      format: "yaml",
      fileContent: this.getFileContent(),
      filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      invalidRootPolicy: "error",
    });
    const overrides = config[TAKT_WORKFLOW_OVERRIDES_KEY];
    if (!isPlainObject(overrides)) {
      return [];
    }

    const checks: RulesyncCheck[] = [];
    // Counts every gate seen, not just the importable ones, so two gates that
    // slugify the same never collide on one file name.
    let seen = 0;
    const editOnly = overrides.quality_gates_edit_only === true;
    const collect = (gates: unknown, scope?: { key: "steps" | "personas"; name: string }): void => {
      if (!Array.isArray(gates)) {
        return;
      }
      for (const gate of gates) {
        const check = toRulesyncCheckFromGate({ gate, index: seen, scope, editOnly });
        seen += 1;
        if (check) {
          checks.push(check);
        }
      }
    };

    collect(overrides.quality_gates);
    for (const key of ["steps", "personas"] as const) {
      const scoped = overrides[key];
      if (!isPlainObject(scoped)) {
        continue;
      }
      for (const [name, block] of Object.entries(scoped)) {
        if (isPlainObject(block)) {
          collect(block.quality_gates, { key, name });
        }
      }
    }
    return checks;
  }
}
