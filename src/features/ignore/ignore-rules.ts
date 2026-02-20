import { dump, load } from "js-yaml";

export const SUPPORTED_IGNORE_ACTIONS = ["read", "write", "edit"] as const;

export type IgnoreAction = (typeof SUPPORTED_IGNORE_ACTIONS)[number];

export type IgnoreRule = {
  path: string;
  actions: IgnoreAction[];
};

type IgnoreYamlValue = {
  version: number;
  rules: Array<{
    path: string;
    actions?: string[];
  }>;
};

const IGNORE_ACTION_SET = new Set<IgnoreAction>(SUPPORTED_IGNORE_ACTIONS);
const IGNORE_ACTION_ORDER: IgnoreAction[] = ["read", "write", "edit"];
const IGNORE_WRAPPER_ACTION_MAP: Record<IgnoreAction, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
};
const ignoreWrapperPattern = /^([A-Za-z][A-Za-z0-9]*)\((.*)\)$/;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeIgnoreAction = (value: string): IgnoreAction | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "read" || normalized === "write" || normalized === "edit") {
    return normalized;
  }
  return null;
};

const createMergedRuleMap = (rules: IgnoreRule[]): Map<string, Set<IgnoreAction>> => {
  const map = new Map<string, Set<IgnoreAction>>();
  for (const rule of rules) {
    const path = rule.path.trim();
    if (path.length === 0) {
      continue;
    }
    const set = map.get(path) ?? new Set<IgnoreAction>();
    for (const action of rule.actions) {
      if (IGNORE_ACTION_SET.has(action)) {
        set.add(action);
      }
    }
    if (set.size > 0) {
      map.set(path, set);
    }
  }
  return map;
};

export const mergeIgnoreRules = (rules: IgnoreRule[]): IgnoreRule[] => {
  const map = createMergedRuleMap(rules);
  return [...map.entries()]
    .toSorted(([pathA], [pathB]) => pathA.localeCompare(pathB))
    .map(([path, actions]) => {
      return {
        path,
        actions: IGNORE_ACTION_ORDER.filter((action) => actions.has(action)),
      };
    });
};

export const parseIgnoreRulesFromText = (
  content: string,
): { rules: IgnoreRule[]; warnings: string[] } => {
  const warnings: string[] = [];
  const rules: IgnoreRule[] = [];

  for (const rawLine of content.split(/\r?\n|\r/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const wrapperMatch = line.match(ignoreWrapperPattern);
    if (!wrapperMatch) {
      rules.push({
        path: line,
        actions: ["read"],
      });
      continue;
    }

    const wrapperAction = wrapperMatch[1] ?? "";
    const action = normalizeIgnoreAction(wrapperAction);
    if (!action) {
      warnings.push(
        `Unsupported ignore action wrapper "${wrapperAction}" in line "${line}". Supported actions: read, write, edit.`,
      );
      continue;
    }

    const path = wrapperMatch[2]?.trim() ?? "";
    if (path.length === 0) {
      warnings.push(`Ignore rule "${line}" has an empty path and was skipped.`);
      continue;
    }

    rules.push({
      path,
      actions: [action],
    });
  }

  return {
    rules: mergeIgnoreRules(rules),
    warnings,
  };
};

export const parseIgnoreRulesFromYaml = (
  content: string,
): { rules: IgnoreRule[]; warnings: string[] } => {
  const parsed = load(content);
  if (!isObjectRecord(parsed)) {
    throw new Error("Invalid .rulesync/ignore.yaml: expected a YAML object at root.");
  }

  const version = parsed.version;
  if (version !== 1) {
    throw new Error(
      `Invalid .rulesync/ignore.yaml: expected version to be 1, received ${String(version)}.`,
    );
  }

  const rawRules = parsed.rules;
  if (!Array.isArray(rawRules)) {
    throw new Error("Invalid .rulesync/ignore.yaml: expected rules to be an array.");
  }

  const warnings: string[] = [];
  const rules: IgnoreRule[] = [];

  rawRules.forEach((ruleValue, index) => {
    if (!isObjectRecord(ruleValue)) {
      throw new Error(
        `Invalid .rulesync/ignore.yaml: rules[${index}] must be an object with path/actions.`,
      );
    }

    const path = typeof ruleValue.path === "string" ? ruleValue.path.trim() : "";
    if (path.length === 0) {
      throw new Error(
        `Invalid .rulesync/ignore.yaml: rules[${index}].path must be a non-empty string.`,
      );
    }

    const actionsValue = ruleValue.actions;
    let normalizedActions: IgnoreAction[] = [];

    if (actionsValue === undefined) {
      normalizedActions = ["read"];
      warnings.push(`rules[${index}] has no actions and defaulted to [read] for path "${path}".`);
    } else if (!Array.isArray(actionsValue)) {
      throw new Error(
        `Invalid .rulesync/ignore.yaml: rules[${index}].actions must be an array of strings.`,
      );
    } else {
      for (const actionValue of actionsValue) {
        if (typeof actionValue !== "string") {
          throw new Error(
            `Invalid .rulesync/ignore.yaml: rules[${index}].actions must only contain strings.`,
          );
        }
        const normalizedAction = normalizeIgnoreAction(actionValue);
        if (!normalizedAction) {
          warnings.push(
            `Unsupported ignore action "${actionValue}" for path "${path}". Supported actions: read, write, edit.`,
          );
          continue;
        }
        normalizedActions.push(normalizedAction);
      }
    }

    normalizedActions = [...new Set(normalizedActions)];
    if (normalizedActions.length === 0) {
      warnings.push(`Path "${path}" has no supported actions and was skipped.`);
      return;
    }

    rules.push({
      path,
      actions: normalizedActions,
    });
  });

  return {
    rules: mergeIgnoreRules(rules),
    warnings,
  };
};

export const buildIgnoreYamlContent = (rules: IgnoreRule[]): string => {
  const mergedRules = mergeIgnoreRules(rules);
  const yamlValue: IgnoreYamlValue = {
    version: 1,
    rules: mergedRules.map((rule) => ({
      path: rule.path,
      actions: rule.actions,
    })),
  };
  return dump(yamlValue, {
    lineWidth: -1,
    noRefs: true,
  });
};

export const convertIgnoreRulesToPathPatterns = (
  rules: IgnoreRule[],
): { patterns: string[]; warnings: string[] } => {
  const mergedRules = mergeIgnoreRules(rules);
  const warnings: string[] = [];
  const patterns = mergedRules.map((rule) => {
    const hasNonRead = rule.actions.some((action) => action !== "read");
    if (hasNonRead) {
      warnings.push(
        `Path "${rule.path}" includes non-read actions (${rule.actions.join(
          ", ",
        )}). Projected to path-only ignore format for this tool target.`,
      );
    }
    return rule.path;
  });
  return { patterns, warnings };
};

export const convertIgnoreRulesToClaudeDenyPatterns = (rules: IgnoreRule[]): string[] => {
  const mergedRules = mergeIgnoreRules(rules);
  const denyPatterns: string[] = [];

  for (const rule of mergedRules) {
    for (const action of rule.actions) {
      denyPatterns.push(`${IGNORE_WRAPPER_ACTION_MAP[action]}(${rule.path})`);
    }
  }

  return denyPatterns;
};
