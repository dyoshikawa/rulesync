import { toolHooksFactories } from "../src/features/hooks/hooks-processor.js";
import { HOOK_EVENTS, type HookEvent } from "../src/types/hooks.js";
import { TOOL_DISPLAY } from "../src/types/tool-display.js";

const MARKER = "HOOK_EVENTS_MATRIX";
const BEGIN = `<!-- ${MARKER}:BEGIN -->`;
const END = `<!-- ${MARKER}:END -->`;

/**
 * Render the `Hook event × tool matrix` table in `docs/reference/file-formats.md`
 * from each hooks factory's `supportedEvents`, so the table cannot drift from
 * `src/types/hooks.ts` (it used to be hand-maintained and was missing columns
 * for several hook-capable targets — and still listed removed ones).
 *
 * Freshness is enforced indirectly: `scripts/generate-docs-content.ts` calls
 * this before embedding the docs, so a stale committed table makes
 * `pnpm run check:docs-content` fail on the regenerated embed.
 */
export const renderHookEventsMatrix = (content: string): string => {
  const factories: ReadonlyMap<string, { supportedEvents: readonly HookEvent[] }> =
    toolHooksFactories;

  // Column order follows TOOL_DISPLAY (the order the other generated tables
  // use), restricted to targets that have a hooks factory.
  const columns = TOOL_DISPLAY.filter((entry) => factories.has(entry.key));
  const displayedKeys = new Set<string>(columns.map((entry) => entry.key));
  const missing = [...factories.keys()].filter((key) => !displayedKeys.has(key));
  if (missing.length > 0) {
    throw new Error(`Hooks targets missing from TOOL_DISPLAY: ${missing.join(", ")}`);
  }

  const supportedSets = new Map<string, ReadonlySet<HookEvent>>(
    columns.map((entry) => [entry.key, new Set(factories.get(entry.key)!.supportedEvents)]),
  );

  // Only events at least one hooks target supports get a row, in the canonical
  // HOOK_EVENTS order.
  const rows = HOOK_EVENTS.filter((event) =>
    columns.some((entry) => supportedSets.get(entry.key)!.has(event)),
  );

  const header = `| Event | ${columns.map((entry) => entry.label).join(" | ")} |`;
  const separator = `| --- | ${columns.map(() => ":-:").join(" | ")} |`;
  const body = rows.map((event) => {
    const cells = columns.map((entry) => (supportedSets.get(entry.key)!.has(event) ? "✅" : "—"));
    return `| \`${event}\` | ${cells.join(" | ")} |`;
  });
  const table = [header, separator, ...body].join("\n");

  const startIdx = content.indexOf(BEGIN);
  const endIdx = content.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Markers ${MARKER} not found; add ${BEGIN} / ${END} around the table.`);
  }
  return `${content.slice(0, startIdx + BEGIN.length)}\n${table}\n${content.slice(endIdx)}`;
};
