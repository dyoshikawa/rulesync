import { z } from "zod/mini";

import { listDocuments, readDocument, searchDocuments } from "../lib/docs.js";
import { type McpCommandResult, runCommandForMcp, stringifyResult } from "./command-runner.js";

/**
 * Schema for docs options
 * - document: return one bundled document's Markdown
 * - search: return ranked matches for the text
 * - neither: list every bundled document identifier
 * Excluded parameters:
 * - verbose/silent: Meaningless in MCP (no console output)
 */
export const docsOptionsSchema = z.object({
  document: z.optional(z.string()),
  search: z.optional(z.string()),
});

export type DocsOptions = z.infer<typeof docsOptionsSchema>;

/**
 * Execute the rulesync docs command via MCP, returning the bundled
 * documentation as data instead of printing it.
 */
export async function executeDocs(options: DocsOptions = {}): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async () => {
      if (options.document !== undefined && options.search !== undefined) {
        throw new Error("Specify either document or search, not both.");
      }
      if (options.search !== undefined) {
        return { query: options.search.trim(), matches: searchDocuments(options.search) };
      }
      if (options.document !== undefined) {
        return readDocument(options.document);
      }
      return { documents: listDocuments() };
    },
  });
}

export const docsTools = {
  executeDocs: {
    name: "executeDocs",
    description:
      "Read the documentation bundled with rulesync: a document's Markdown by identifier (e.g. 'guide/configuration'), ranked search matches, or, with no options, the list of document identifiers.",
    parameters: docsOptionsSchema,
    execute: async (options: DocsOptions = {}): Promise<string> =>
      stringifyResult(await executeDocs(options)),
  },
};
