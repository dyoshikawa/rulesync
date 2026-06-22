import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getProcessorRegistryEntry, PROCESSOR_REGISTRY } from "../src/types/processor-registry.js";
import { TOOL_DISPLAY, type ToolDisplayEntry } from "../src/types/tool-display.js";
import { ALL_TOOL_TARGETS, type ToolTarget } from "../src/types/tool-targets.js";
import { formatError } from "../src/utils/error.js";

const FEATURES = [
  "rules",
  "ignore",
  "mcp",
  "commands",
  "subagents",
  "skills",
  "hooks",
  "permissions",
] as const;
type FeatureName = (typeof FEATURES)[number];

const setOf = (targets: ToolTarget[]): ReadonlySet<ToolTarget> => new Set(targets);

// A processor that does not support global mode throws; treat that as "no global
// targets" but surface it, so a real bug in a global implementation can't silently
// drop every 🌏 glyph for that feature.
const safeGlobal = (feature: string, fn: () => ToolTarget[]): ToolTarget[] => {
  try {
    return fn();
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error(
      `Warning: ${feature} getToolTargets({ global: true }) failed: ${formatError(error)}`,
    );
    return [];
  }
};

// Per-feature support, split by mode, derived from each registered processor's
// getToolTargets — no per-feature wiring to keep in sync.
const project = {} as Record<FeatureName, ReadonlySet<ToolTarget>>;
const global = {} as Record<FeatureName, ReadonlySet<ToolTarget>>;
const simulated = {} as Partial<Record<FeatureName, ReadonlySet<ToolTarget>>>;
for (const { feature, processor } of PROCESSOR_REGISTRY) {
  const f = feature as FeatureName;
  project[f] = setOf(processor.getToolTargets());
  global[f] = setOf(safeGlobal(feature, () => processor.getToolTargets({ global: true })));
  if (processor.getToolTargetsSimulated) {
    simulated[f] = setOf(processor.getToolTargetsSimulated());
  }
}

const mcpFactory = getProcessorRegistryEntry("mcp").factory as ReadonlyMap<
  ToolTarget,
  { meta: { supportsEnabledTools: boolean; supportsDisabledTools: boolean } }
>;
const mcpToolConfig = setOf(
  [...mcpFactory.entries()]
    .filter(([, f]) => f.meta.supportsEnabledTools || f.meta.supportsDisabledTools)
    .map(([target]) => target),
);

const supports = (feature: FeatureName, key: ToolTarget): boolean =>
  project[feature].has(key) || global[feature].has(key) || (simulated[feature]?.has(key) ?? false);

// Compact cell for the README tables: just ✅ when supported in any mode.
const readmeCell = (feature: FeatureName, key: ToolTarget): string =>
  supports(feature, key) ? "✅" : "";

// Detailed cell for the docs table: per-mode glyphs.
const docsCell = (feature: FeatureName, key: ToolTarget): string => {
  const glyphs: string[] = [];
  if (project[feature].has(key)) glyphs.push("✅");
  else if (simulated[feature]?.has(key)) glyphs.push("🎮");
  if (global[feature].has(key)) glyphs.push("🌏");
  if (feature === "mcp" && mcpToolConfig.has(key)) glyphs.push("🔧");
  return glyphs.join(" ");
};

const FEATURE_HEADERS = FEATURES.map((f) => f);

const buildReadmeTable = (entries: ToolDisplayEntry[]): string => {
  const header = `| Tool | ${FEATURE_HEADERS.join(" | ")} |`;
  const sep = `| --- | ${FEATURE_HEADERS.map(() => ":-:").join(" | ")} |`;
  const rows = entries.map((e) => {
    const cells = FEATURES.map((f) => readmeCell(f, e.key));
    return `| ${e.label} | ${cells.join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
};

const buildDocsTable = (): string => {
  const header = `| Tool | --targets | ${FEATURE_HEADERS.join(" | ")} |`;
  const sep = `| --- | --- | ${FEATURE_HEADERS.map(() => ":-:").join(" | ")} |`;
  const rows = TOOL_DISPLAY.map((e) => {
    const cells = FEATURES.map((f) => docsCell(f, e.key));
    return `| ${e.label} | ${e.key} | ${cells.join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
};

const README_AI_MARK = "SUPPORTED_TOOLS_AI";
const README_STD_MARK = "SUPPORTED_TOOLS_STANDARD";
const DOCS_MARK = "SUPPORTED_TOOLS_DOCS";

const replaceBetween = (content: string, marker: string, body: string): string => {
  const begin = `<!-- ${marker}:BEGIN -->`;
  const end = `<!-- ${marker}:END -->`;
  const startIdx = content.indexOf(begin);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Markers ${marker} not found; add ${begin} / ${end} around the table.`);
  }
  return `${content.slice(0, startIdx + begin.length)}\n${body}\n${content.slice(endIdx)}`;
};

const renderReadme = (content: string): string => {
  const ai = buildReadmeTable(TOOL_DISPLAY.filter((e) => e.group === "ai"));
  const std = buildReadmeTable(TOOL_DISPLAY.filter((e) => e.group === "standard"));
  return replaceBetween(replaceBetween(content, README_AI_MARK, ai), README_STD_MARK, std);
};

const renderDocs = (content: string): string =>
  replaceBetween(content, DOCS_MARK, buildDocsTable());

const main = (): void => {
  // Display list must cover exactly the non-legacy targets.
  const displayed = new Set(TOOL_DISPLAY.map((e) => e.key));
  const expected = ALL_TOOL_TARGETS.filter((t) => !t.endsWith("-legacy"));
  const missing = expected.filter((t) => !displayed.has(t));
  const extra = [...displayed].filter((t) => !expected.includes(t));
  if (missing.length || extra.length) {
    // oxlint-disable-next-line no-console
    console.error(
      `TOOL_DISPLAY drift — missing: ${missing.join(", ")}; extra: ${extra.join(", ")}`,
    );
    process.exit(1);
  }

  const root = process.cwd();
  const targets = [
    { path: join(root, "README.md"), render: renderReadme },
    { path: join(root, "docs/reference/supported-tools.md"), render: renderDocs },
  ];
  for (const { path, render } of targets) {
    writeFileSync(path, render(readFileSync(path, "utf8")));
  }

  // Tables are written without column alignment; oxfmt owns the final layout, so
  // run it here. Freshness is checked in CI by running this script then
  // `git diff` (see the `check:supported-tools` package script) — the same
  // approach as the gitignore generator, avoiding an oxfmt-vs-generator conflict.
  execFileSync("pnpm", ["exec", "oxfmt", ...targets.map((t) => t.path)], { stdio: "inherit" });
};

main();
