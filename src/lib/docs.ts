import MiniSearch from "minisearch";

import { DOCS_CONTENT } from "../generated/docs-content.js";

/** Maximum number of search results returned. */
const SEARCH_RESULT_LIMIT = 10;

/**
 * Normalize a user-supplied document identifier to the bundled-content key:
 * forward slashes, no leading `docs/`, no trailing `.md`. Returns null for
 * identifiers that try to escape the bundled tree (absolute paths, `..`
 * segments, drive letters) — the command only ever serves the embedded
 * Markdown map, but rejecting these keeps the contract explicit and the
 * error message honest.
 */
export function normalizeDocId(input: string): string | null {
  const slashed = input.replaceAll("\\", "/").trim();
  if (slashed === "" || slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
    return null;
  }
  const segments = slashed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    return null;
  }
  if (segments[0] === "docs") {
    segments.shift();
  }
  if (segments.length === 0) {
    return null;
  }
  const joined = segments.join("/");
  return joined.endsWith(".md") ? joined.slice(0, -".md".length) : joined;
}

/** First `# ` heading of a document, or its identifier when none exists. */
function titleOf(id: string, content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? id;
}

/** All `##`+ headings of a document, joined for indexing. */
function headingsOf(content: string): string {
  return [...content.matchAll(/^#{2,6}\s+(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .join("\n");
}

/**
 * First line containing any of the search terms, trimmed as a snippet, so a
 * result identifies where the match lives. Falls back to the title line.
 */
function contextSnippet(content: string, terms: string[]): string {
  const lowerTerms = terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
  for (const line of content.split("\n")) {
    const lowerLine = line.toLowerCase();
    if (lowerTerms.some((term) => lowerLine.includes(term))) {
      const trimmed = line.trim();
      return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
    }
  }
  return content.split("\n")[0]?.trim() ?? "";
}

function buildSearchIndex(): MiniSearch<{
  id: string;
  title: string;
  headings: string;
  body: string;
}> {
  const miniSearch = new MiniSearch({
    fields: ["id", "title", "headings", "body"],
    searchOptions: {
      // Titles and headings identify a document better than a body mention.
      boost: { title: 4, headings: 3, id: 2 },
    },
  });
  miniSearch.addAll(
    Object.entries(DOCS_CONTENT).map(([id, content]) => ({
      id,
      title: titleOf(id, content),
      headings: headingsOf(content),
      body: content,
    })),
  );
  return miniSearch;
}

/** Every bundled document identifier, sorted. */
export function listDocuments(): string[] {
  return Object.keys(DOCS_CONTENT).toSorted();
}

/**
 * The Markdown of one bundled document, verbatim. Throws for an identifier
 * that is invalid or names no bundled document.
 */
export function readDocument(document: string): { id: string; content: string } {
  const id = normalizeDocId(document);
  if (id === null) {
    throw new Error(`Invalid document identifier: '${document}'.`);
  }
  // `Object.hasOwn` keeps prototype keys such as `constructor` from leaking
  // inherited values past the undefined check.
  const content = Object.hasOwn(DOCS_CONTENT, id) ? DOCS_CONTENT[id] : undefined;
  if (content === undefined) {
    throw new Error(`Unknown document '${id}'. Run 'rulesync docs' to list documents.`);
  }
  return { id, content };
}

export type DocsSearchMatch = {
  id: string;
  /** The first line of the document mentioning a search term. */
  snippet: string;
};

/**
 * Ranked matches for `search` (at most {@link SEARCH_RESULT_LIMIT}), empty
 * when nothing matches. Throws for an empty search text.
 */
export function searchDocuments(search: string): DocsSearchMatch[] {
  const query = search.trim();
  if (query === "") {
    throw new Error("--search requires a non-empty search text.");
  }
  const results = buildSearchIndex().search(query).slice(0, SEARCH_RESULT_LIMIT);
  const terms = query.split(/\s+/);
  return results.map((result) => {
    const content = Object.hasOwn(DOCS_CONTENT, result.id) ? (DOCS_CONTENT[result.id] ?? "") : "";
    return { id: result.id, snippet: contextSnippet(content, terms) };
  });
}
