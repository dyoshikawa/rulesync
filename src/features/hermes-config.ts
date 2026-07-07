import { dump, load } from "js-yaml";

import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../utils/prototype-pollution.js";
import { isPlainObject } from "../utils/type-guards.js";

type HermesConfig = Record<string, unknown>;

function sanitizeHermesConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeHermesConfigValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized = omitPrototypePollutionKeys(value);
  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(sanitized)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    result[key] = sanitizeHermesConfigValue(nestedValue);
  }

  return result;
}

export function parseHermesConfig(fileContent: string): HermesConfig {
  if (!fileContent.trim()) {
    return {};
  }

  const parsed = load(fileContent);

  if (isPlainObject(parsed)) {
    return sanitizeHermesConfigValue(parsed) as HermesConfig;
  }

  return {};
}

export function stringifyHermesConfig(config: HermesConfig): string {
  return dump(config, { noRefs: true, sortKeys: false }).trimEnd() + "\n";
}

export function mergeHermesConfig(fileContent: string, patch: HermesConfig): string {
  return stringifyHermesConfig({
    ...parseHermesConfig(fileContent),
    ...patch,
  });
}

/**
 * Recursively merge `patch` into `base` (patch wins). Nested plain objects are
 * merged key-by-key; every other value (arrays, scalars) is replaced wholesale.
 * Used to overlay the Hermes-scoped permission override onto the natively
 * emitted `approvals`/`security` structures without one clobbering the other
 * (e.g. `approvals.deny` from canonical deny rules coexisting with an
 * `approvals.mode` from the override). Prototype-pollution keys are dropped.
 */
export function deepMergeHermesConfig(base: HermesConfig, patch: HermesConfig): HermesConfig {
  const result: HermesConfig = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = deepMergeHermesConfig(baseValue, patchValue);
    } else {
      result[key] = sanitizeHermesConfigValue(patchValue);
    }
  }

  return result;
}
