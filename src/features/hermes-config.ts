import { load, dump } from "js-yaml";

type HermesConfig = Record<string, unknown>;

export function parseHermesConfig(fileContent: string): HermesConfig {
  if (!fileContent.trim()) {
    return {};
  }
  const parsed = load(fileContent);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as HermesConfig;
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
