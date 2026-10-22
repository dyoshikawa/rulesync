// cspell:ignore zzzqqqnotaword
import { describe, expect, it } from "vitest";

import { executeDocs } from "./docs.js";

describe("executeDocs", () => {
  it("lists the bundled documents when no option is given", async () => {
    const result = await executeDocs();

    expect(result.success).toBe(true);
    expect(result.result?.documents).toContain("guide/configuration");
  });

  it("returns a document's Markdown", async () => {
    const result = await executeDocs({ document: "docs/guide/configuration.md" });

    expect(result.success).toBe(true);
    expect(result.result?.id).toBe("guide/configuration");
    expect(result.result?.content).toMatch(/^# /m);
  });

  it("returns search matches", async () => {
    const result = await executeDocs({ search: "configuration" });

    expect(result.success).toBe(true);
    expect(result.result?.query).toBe("configuration");
    const matches = result.result?.matches as Array<{ id: string; snippet: string }>;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toEqual({ id: expect.any(String), snippet: expect.any(String) });
  });

  it("returns an empty match list when nothing matches", async () => {
    const result = await executeDocs({ search: "zzzqqqnotaword" });

    expect(result.success).toBe(true);
    expect(result.result?.matches).toEqual([]);
  });

  it("fails for unknown or invalid documents and conflicting options", async () => {
    expect((await executeDocs({ document: "nope/missing" })).error).toContain("Unknown document");
    expect((await executeDocs({ document: "../secrets" })).error).toContain("Invalid document");
    expect((await executeDocs({ document: "faq", search: "x" })).error).toContain("not both");
    expect((await executeDocs({ search: "  " })).success).toBe(false);
  });
});
