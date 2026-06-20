import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getProcessorRegistryEntry, PROCESSOR_REGISTRY } from "../src/types/processor-registry.js";
import { ALL_TOOL_TARGETS, type ToolTarget } from "../src/types/tool-targets.js";
import { formatError } from "../src/utils/error.js";

// Display metadata — the only hand-maintained part: label, ordering and grouping
// for each target. Support cells are derived from each feature's getToolTargets,
// so the ✅/mode matrix never needs manual editing. `legacy` targets are aliases
// that are intentionally hidden from the user-facing tables.
type Group = "ai" | "standard";
type DisplayEntry = { key: ToolTarget; label: string; group: Group };

const DISPLAY: DisplayEntry[] = [
  { key: "agentsmd", label: "AGENTS.md", group: "standard" },
  { key: "agentsskills", label: "AgentsSkills", group: "standard" },
  { key: "amp", label: "Amp", group: "ai" },
  { key: "claudecode", label: "Claude Code", group: "ai" },
  { key: "codexcli", label: "Codex CLI", group: "ai" },
  { key: "geminicli", label: "Gemini CLI ⚠️", group: "ai" },
  { key: "copilot", label: "GitHub Copilot", group: "ai" },
  { key: "copilotcli", label: "GitHub Copilot CLI", group: "ai" },
  { key: "goose", label: "Goose", group: "ai" },
  { key: "grokcli", label: "Grok CLI", group: "ai" },
  { key: "cursor", label: "Cursor", group: "ai" },
  { key: "deepagents", label: "deepagents-cli", group: "ai" },
  { key: "factorydroid", label: "Factory Droid", group: "ai" },
  { key: "opencode", label: "OpenCode", group: "ai" },
  { key: "cline", label: "Cline", group: "ai" },
  { key: "kilo", label: "Kilo Code", group: "ai" },
  { key: "roo", label: "Roo Code", group: "ai" },
  { key: "rovodev", label: "Rovodev (Atlassian)", group: "ai" },
  { key: "takt", label: "Takt", group: "ai" },
  { key: "vibe", label: "Vibe Code", group: "ai" },
  { key: "qwencode", label: "Qwen Code", group: "ai" },
  { key: "kiro", label: "Kiro ⚠️", group: "ai" },
  { key: "kiro-cli", label: "Kiro CLI", group: "ai" },
  { key: "kiro-ide", label: "Kiro IDE", group: "ai" },
  { key: "antigravity-ide", label: "Google Antigravity IDE", group: "ai" },
  { key: "antigravity-cli", label: "Google Antigravity CLI", group: "ai" },
  { key: "antigravity", label: "Google Antigravity ⚠️", group: "ai" },
  { key: "junie", label: "JetBrains Junie", group: "ai" },
  { key: "augmentcode", label: "AugmentCode", group: "ai" },
  { key: "devin", label: "Devin Desktop", group: "ai" },
  { key: "warp", label: "Warp", group: "ai" },
  { key: "replit", label: "Replit", group: "ai" },
  { key: "pi", label: "Pi Coding Agent", group: "ai" },
  { key: "zed", label: "Zed", group: "ai" },
];

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

const buildReadmeTable = (entries: DisplayEntry[]): string => {
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
  const rows = DISPLAY.map((e) => {
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
  const ai = buildReadmeTable(DISPLAY.filter((e) => e.group === "ai"));
  const std = buildReadmeTable(DISPLAY.filter((e) => e.group === "standard"));
  return replaceBetween(replaceBetween(content, README_AI_MARK, ai), README_STD_MARK, std);
};

const renderDocs = (content: string): string =>
  replaceBetween(content, DOCS_MARK, buildDocsTable());

const main = (): void => {
  const check = process.argv.includes("--check");
  const root = process.cwd();
  const targets = [
    { path: join(root, "README.md"), render: renderReadme },
    { path: join(root, "docs/reference/supported-tools.md"), render: renderDocs },
  ];

  let drift = false;
  for (const { path, render } of targets) {
    const current = readFileSync(path, "utf8");
    const next = render(current);
    if (current === next) continue;
    if (check) {
      drift = true;
      // oxlint-disable-next-line no-console
      console.error(`Supported-tools table is stale: ${path}. Run \`pnpm run generate:tables\`.`);
    } else {
      writeFileSync(path, next);
      // oxlint-disable-next-line no-console
      console.log(`Updated ${path}`);
    }
  }

  // Display list must cover exactly the non-legacy targets.
  const displayed = new Set(DISPLAY.map((e) => e.key));
  const expected = ALL_TOOL_TARGETS.filter((t) => !t.endsWith("-legacy"));
  const missing = expected.filter((t) => !displayed.has(t));
  const extra = [...displayed].filter((t) => !expected.includes(t));
  if (missing.length || extra.length) {
    drift = true;
    // oxlint-disable-next-line no-console
    console.error(`DISPLAY drift — missing: ${missing.join(", ")}; extra: ${extra.join(", ")}`);
  }

  if (check && drift) process.exit(1);
};

main();
