import { join } from "node:path";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../constants/opencode-paths.js";
import { readFileContentOrNull } from "../utils/file.js";
import { isStringArray } from "../utils/type-guards.js";
import { parseSharedConfig } from "./shared/shared-config-gateway.js";

/**
 * Reads and parses the OpenCode config (`opencode.jsonc` preferred, then
 * `opencode.json`) from the project root (or `~/.config/opencode/` in global
 * mode), returning an empty object when no readable config object exists.
 *
 * OpenCode lets users define commands and agents inline in this config (under
 * the top-level `command` / `agent` keys) in addition to the Markdown files
 * under `.opencode/command/` and `.opencode/agent/`. This shared reader is the
 * entry point used to import those inline definitions.
 *
 * @see https://opencode.ai/docs/commands/#json
 * @see https://opencode.ai/docs/agents/#json
 */
export function getOpencodeConfigDir({
  outputRoot,
  global = false,
  layout = OPENCODE_LAYOUT,
}: {
  outputRoot: string;
  global?: boolean;
  layout?: OpencodeLayout;
}): string {
  return join(outputRoot, global ? layout.globalDir : layout.configDir);
}

export async function readOpencodeConfig({
  outputRoot,
  global = false,
  layout = OPENCODE_LAYOUT,
}: {
  outputRoot: string;
  global?: boolean;
  layout?: OpencodeLayout;
}): Promise<Record<string, unknown>> {
  const configDir = getOpencodeConfigDir({ outputRoot, global, layout });

  const fileContent =
    (await readFileContentOrNull(join(configDir, layout.jsoncFileName))) ??
    (await readFileContentOrNull(join(configDir, layout.jsonFileName)));

  if (!fileContent) {
    return {};
  }

  return parseSharedConfig({ format: "jsonc", fileContent });
}

/**
 * Narrows an unknown value to a plain record of entries keyed by name, as used
 * for OpenCode's `command` / `agent` config sections. Returns `null` when the
 * value is not a usable object.
 */
export function asOpencodeEntries(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Lowers an OpenCode V2 model selection — `"provider/model"`, optionally with a
 * `#variant` suffix, or `{ providerID, model, variant }` — into V1's separate
 * `model` / `variant` fields. Returns an empty object for anything else.
 */
function lowerOpencodeV2ModelSelection(value: unknown): { model?: string; variant?: string } {
  if (typeof value === "string") {
    const index = value.indexOf("#");
    return index === -1
      ? { model: value }
      : { model: value.slice(0, index), variant: value.slice(index + 1) };
  }
  const selection = asOpencodeEntries(value);
  if (
    selection === null ||
    typeof selection.providerID !== "string" ||
    typeof selection.model !== "string"
  ) {
    return {};
  }
  return {
    model: `${selection.providerID}/${selection.model}`,
    ...(typeof selection.variant === "string" && { variant: selection.variant }),
  };
}

/**
 * Lowers one OpenCode V2 `agents` entry into the V1 `agent` entry shape, the
 * way OpenCode V1 itself does: `system` becomes `prompt`, `disabled` becomes
 * `disable`, `request.body` becomes `options`, and the model selection is split
 * into `model` / `variant`. Fields V1 cannot represent are dropped, as V1 does.
 * Unlike V1, fields are checked one by one rather than the whole entry being
 * validated, so a malformed field is skipped instead of dropping the entry.
 */
function lowerOpencodeV2Agent(entry: Record<string, unknown>): Record<string, unknown> {
  const request = asOpencodeEntries(entry.request);
  const body = request === null ? null : asOpencodeEntries(request.body);
  return {
    ...(typeof entry.description === "string" && { description: entry.description }),
    ...(typeof entry.mode === "string" && { mode: entry.mode }),
    ...(typeof entry.hidden === "boolean" && { hidden: entry.hidden }),
    ...(typeof entry.color === "string" && { color: entry.color }),
    ...(typeof entry.steps === "number" && { steps: entry.steps }),
    ...(typeof entry.system === "string" && { prompt: entry.system }),
    ...(typeof entry.disabled === "boolean" && { disable: entry.disabled }),
    ...lowerOpencodeV2ModelSelection(entry.model),
    ...(body !== null && { options: body }),
  };
}

/**
 * Merges the entries of a V1 config section (`agent` / `command`) with those
 * of its V2 plural spelling (`agents` / `commands`), lowering each V2 entry.
 * The V1 entry wins a name both define, and a V1 key that is present but not
 * an object disables the merge — both as OpenCode V1 resolves them.
 */
function mergeOpencodeV2Entries({
  config,
  legacyKey,
  pluralKey,
  lower,
}: {
  config: Record<string, unknown>;
  legacyKey: string;
  pluralKey: string;
  lower: (entry: Record<string, unknown>) => Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const legacy = asOpencodeEntries(config[legacyKey]);
  const plural = asOpencodeEntries(config[pluralKey]);
  if (plural === null || (Object.hasOwn(config, legacyKey) && legacy === null)) {
    return legacy;
  }
  const merged: Record<string, unknown> = { ...legacy };
  for (const [name, value] of Object.entries(plural)) {
    const entry = asOpencodeEntries(value);
    const lowered = entry === null ? null : lower(entry);
    if (Object.hasOwn(merged, name) || lowered === null) {
      continue;
    }
    // A plain assignment to a key named `__proto__` would set the prototype.
    Object.defineProperty(merged, name, {
      value: lowered,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.keys(merged).length > 0 ? merged : legacy;
}

/**
 * Returns the inline agent entries of an OpenCode config in the V1 `agent`
 * shape. Since v1.18.24 OpenCode V1 also reads the V2 `agents` spelling and
 * lowers it, so a layout that does so (`readsV2ConfigSpellings`) gets those
 * entries too.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/v2-compat.ts
 */
export function getOpencodeAgentEntries({
  config,
  layout = OPENCODE_LAYOUT,
}: {
  config: Record<string, unknown>;
  layout?: OpencodeLayout;
}): Record<string, unknown> | null {
  if (!layout.readsV2ConfigSpellings) {
    return asOpencodeEntries(config.agent);
  }
  return mergeOpencodeV2Entries({
    config,
    legacyKey: "agent",
    pluralKey: "agents",
    lower: lowerOpencodeV2Agent,
  });
}

/**
 * Returns the inline command entries of an OpenCode config in the V1 `command`
 * shape, including V2 `commands` entries for a layout that reads them (see
 * `getOpencodeAgentEntries`). A V2 entry without a `template` is skipped, as
 * OpenCode V1 skips it; its model selection is split into `model` / `variant`.
 * Other fields are kept: V1 drops a V2 `subagent`, but rulesync reads it as
 * `subtask` everywhere (as V2 does), so it is left for the command importer.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/v2-compat.ts
 */
export function getOpencodeCommandEntries({
  config,
  layout = OPENCODE_LAYOUT,
}: {
  config: Record<string, unknown>;
  layout?: OpencodeLayout;
}): Record<string, unknown> | null {
  if (!layout.readsV2ConfigSpellings) {
    return asOpencodeEntries(config.command);
  }
  return mergeOpencodeV2Entries({
    config,
    legacyKey: "command",
    pluralKey: "commands",
    lower: (entry) => {
      if (typeof entry.template !== "string") {
        return null;
      }
      const { model, ...rest } = entry;
      return { ...rest, ...lowerOpencodeV2ModelSelection(model) };
    },
  });
}

/**
 * Returns the `skills.paths` entries of an OpenCode config. For a layout that
 * reads V2 spellings, a flat V2 `skills` array is accepted too: its entries
 * that are not `http(s)://` URLs are the paths, as OpenCode V1 lowers them.
 *
 * @see https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/v2-compat.ts
 */
export function getOpencodeSkillPaths({
  config,
  layout = OPENCODE_LAYOUT,
}: {
  config: Record<string, unknown>;
  layout?: OpencodeLayout;
}): unknown[] {
  if (Array.isArray(config.skills)) {
    if (!layout.readsV2ConfigSpellings || !isStringArray(config.skills)) {
      return [];
    }
    return config.skills.filter((value) => !/^https?:\/\//i.test(value));
  }
  const skills = asOpencodeEntries(config.skills);
  return skills !== null && Array.isArray(skills.paths) ? skills.paths : [];
}

/** Matches a string whose entire value is an OpenCode `{file:...}` reference. */
const OPENCODE_FILE_TEMPLATE_PATTERN = /^\s*\{file:(.+?)\}\s*$/;

/**
 * Resolves an OpenCode `{file:./path}` string reference into the referenced
 * file's contents. OpenCode resolves these paths relative to the config file's
 * location, so `configDir` must be the directory holding `opencode.json`. When
 * the value is not a whole-value file reference it is returned unchanged; when
 * the referenced file cannot be read the literal value is preserved (so the
 * reference is not silently lost).
 *
 * @see https://opencode.ai/docs/agents/
 */
export async function resolveOpencodeFileTemplate({
  value,
  configDir,
}: {
  value: string;
  configDir: string;
}): Promise<string> {
  const match = OPENCODE_FILE_TEMPLATE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const referencedPath = match[1]?.trim().replace(/^\.\//, "");
  if (!referencedPath) {
    return value;
  }

  return (await readFileContentOrNull(join(configDir, referencedPath))) ?? value;
}
