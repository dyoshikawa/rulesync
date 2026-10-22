// cspell:ignore zzzqqqnotaword
import { describe, expect, it } from "vitest";

import { listDocuments, normalizeDocId, readDocument, searchDocuments } from "./docs.js";

describe("normalizeDocId", () => {
  it("passes through plain and nested identifiers", () => {
    expect(normalizeDocId("faq")).toBe("faq");
    expect(normalizeDocId("guide/configuration")).toBe("guide/configuration");
  });

  it("strips the docs/ prefix and the .md extension", () => {
    expect(normalizeDocId("docs/faq.md")).toBe("faq");
    expect(normalizeDocId("guide/configuration.md")).toBe("guide/configuration");
  });

  it("normalizes backslashes and redundant segments", () => {
    expect(normalizeDocId("guide\\configuration")).toBe("guide/configuration");
    expect(normalizeDocId("./guide//configuration")).toBe("guide/configuration");
  });

  it("rejects traversal, absolute paths, and drive letters", () => {
    expect(normalizeDocId("../package.json")).toBeNull();
    expect(normalizeDocId("guide/../../secret")).toBeNull();
    expect(normalizeDocId("/etc/passwd")).toBeNull();
    expect(normalizeDocId("C:/windows")).toBeNull();
    expect(normalizeDocId("")).toBeNull();
    expect(normalizeDocId("docs")).toBeNull();
  });
});

describe("listDocuments", () => {
  it("returns sorted document identifiers", () => {
    const documents = listDocuments();
    expect(documents).toContain("guide/configuration");
    expect(documents).toEqual(documents.toSorted());
  });
});

describe("readDocument", () => {
  it("returns the normalized identifier and the Markdown", () => {
    const { id, content } = readDocument("docs/guide/configuration.md");
    expect(id).toBe("guide/configuration");
    expect(content).toMatch(/^# /m);
  });

  it("throws for invalid and unknown identifiers", () => {
    expect(() => readDocument("../secret")).toThrow("Invalid document identifier");
    expect(() => readDocument("nope/missing")).toThrow("Unknown document");
    expect(() => readDocument("constructor")).toThrow("Unknown document");
  });
});

describe("searchDocuments", () => {
  it("returns ranked matches with snippets", () => {
    const matches = searchDocuments("gitignore");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(10);
    expect(matches[0]?.snippet.toLowerCase()).toContain("gitignore");
  });

  it("returns no matches for an unknown word and throws for empty text", () => {
    expect(searchDocuments("zzzqqqnotaword")).toEqual([]);
    expect(() => searchDocuments("   ")).toThrow("non-empty");
  });
});
