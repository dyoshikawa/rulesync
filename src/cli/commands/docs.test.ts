// cspell:ignore zzzznotfoundzzzz
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { docsCommand } from "./docs.js";

let stdoutLines: string[] = [];

beforeEach(() => {
  stdoutLines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdoutLines.push(String(chunk).replace(/\n$/, ""));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("docsCommand", () => {
  it("prints the requested document verbatim", async () => {
    await docsCommand(createMockLogger(), "faq", {});

    expect(stdoutLines.join("\n")).toContain("# FAQ");
  });

  it("lists document identifiers when no argument is given", async () => {
    await docsCommand(createMockLogger(), undefined, {});

    expect(stdoutLines).toContain("faq");
    expect(stdoutLines).toContain("guide/configuration");
    // Sorted, one identifier per line.
    expect(stdoutLines).toEqual([...stdoutLines].toSorted());
  });

  it("prints ranked search results with the document path and context", async () => {
    await docsCommand(createMockLogger(), undefined, { search: "global mode" });

    expect(stdoutLines.join("\n")).toContain("guide/global-mode — ");
  });

  it("throws for an unknown document", async () => {
    await expect(docsCommand(createMockLogger(), "no-such-document", {})).rejects.toThrow(
      /Unknown document 'no-such-document'/,
    );
  });

  it("throws for unsafe identifiers", async () => {
    await expect(docsCommand(createMockLogger(), "../package.json", {})).rejects.toThrow(
      /Invalid document identifier/,
    );
  });

  it("throws for an empty search text", async () => {
    await expect(docsCommand(createMockLogger(), undefined, { search: "  " })).rejects.toThrow(
      /non-empty search text/,
    );
  });

  it("throws when no documents match the search", async () => {
    await expect(
      docsCommand(createMockLogger(), undefined, { search: "zzzznotfoundzzzz" }),
    ).rejects.toThrow(/No documents match/);
  });

  it("throws when a document argument and --search are combined", async () => {
    await expect(docsCommand(createMockLogger(), "faq", { search: "x" })).rejects.toThrow(
      /not both/,
    );
  });
});
