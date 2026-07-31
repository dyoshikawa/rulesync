import { describe, expect, it } from "vitest";

import { toolHooksFactories } from "../src/features/hooks/hooks-processor.js";
import { HOOK_EVENTS } from "../src/types/hooks.js";
import { TOOL_DISPLAY } from "../src/types/tool-display.js";
import { renderHookEventsMatrix } from "./hook-events-table.js";
import { replaceBetweenMarkers } from "./markdown-markers.js";

const wrap = (inner: string): string =>
  `before\n<!-- HOOK_EVENTS_MATRIX:BEGIN -->\n${inner}\n<!-- HOOK_EVENTS_MATRIX:END -->\nafter`;

describe("renderHookEventsMatrix", () => {
  it("replaces the content between the markers with the generated table", () => {
    const result = renderHookEventsMatrix(wrap("| stale |"));

    expect(result).not.toContain("| stale |");
    expect(result.startsWith("before\n<!-- HOOK_EVENTS_MATRIX:BEGIN -->\n| Event |")).toBe(true);
    expect(result.endsWith("<!-- HOOK_EVENTS_MATRIX:END -->\nafter")).toBe(true);
  });

  it("renders one column per hooks target and one row per supported event", () => {
    const result = renderHookEventsMatrix(wrap(""));
    const tableLines = result
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .filter((line) => !line.startsWith("| ---"));

    const header = tableLines[0]!;
    const headerLabels = header
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .slice(1);
    const hooksLabels = TOOL_DISPLAY.filter((entry) =>
      toolHooksFactories.has(entry.key as never),
    ).map((entry) => entry.label);
    expect(headerLabels).toEqual(hooksLabels);

    const supportedEventCount = HOOK_EVENTS.filter((event) =>
      [...toolHooksFactories.values()].some((factory) => factory.supportedEvents.includes(event)),
    ).length;
    expect(tableLines.length - 1).toBe(supportedEventCount);
  });

  it("marks each cell from the factory's supportedEvents", () => {
    const result = renderHookEventsMatrix(wrap(""));
    const columns = TOOL_DISPLAY.filter((entry) => toolHooksFactories.has(entry.key as never));
    const rows = result
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => {
        const cells = line
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean);
        return { event: cells[0]!.replaceAll("`", ""), cells: cells.slice(1) };
      });

    for (const { event, cells } of rows) {
      cells.forEach((cell, index) => {
        const factory = toolHooksFactories.get(columns[index]!.key as never)!;
        const expected = factory.supportedEvents.includes(event as never) ? "✅" : "—";
        expect(cell, `${event} × ${columns[index]!.label}`).toBe(expected);
      });
    }
  });

  it("throws when the markers are missing", () => {
    expect(() => renderHookEventsMatrix("no markers here")).toThrow(
      "Markers HOOK_EVENTS_MATRIX not found",
    );
  });
});

describe("replaceBetweenMarkers", () => {
  it("throws when END precedes BEGIN instead of duplicating content", () => {
    const content = "<!-- M:END -->\nmiddle\n<!-- M:BEGIN -->";
    expect(() => replaceBetweenMarkers(content, "M", "body")).toThrow("Markers M not found");
  });
});
