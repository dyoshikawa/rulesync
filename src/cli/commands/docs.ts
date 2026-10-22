import { listDocuments, readDocument, searchDocuments } from "../../lib/docs.js";
import type { Logger } from "../../utils/logger.js";

export type DocsOptions = {
  search?: string;
};

/**
 * The command's product is its stdout (piped to other tools, read by agents),
 * so it is written directly rather than through the logger — logger output is
 * suppressed under --silent and in test environments, which must not swallow
 * the requested document.
 */
function printLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Exit quietly when the consumer closes the pipe early (`rulesync docs faq |
 * head`); every other stream error keeps its default crash behavior.
 */
let closedPipeTolerated = false;
function tolerateClosedPipe(): void {
  if (closedPipeTolerated) {
    return;
  }
  closedPipeTolerated = true;
  process.stdout.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }
    throw error;
  });
}

/**
 * `rulesync docs` — print bundled documentation.
 *
 * - `rulesync docs` lists every available document identifier.
 * - `rulesync docs <document>` prints the document's Markdown verbatim.
 * - `rulesync docs --search <text>` prints ranked matches, one per line, as
 *   `<document> — <matching context>`.
 *
 * Missing documents, empty/matchless searches, and combining a document
 * argument with `--search` are errors (non-zero exit via the thrown Error).
 */
export async function docsCommand(
  logger: Logger,
  document: string | undefined,
  options: DocsOptions,
): Promise<void> {
  if (options.search !== undefined && document !== undefined) {
    throw new Error("Specify either a document or --search <text>, not both.");
  }
  tolerateClosedPipe();

  if (options.search !== undefined) {
    const matches = searchDocuments(options.search);
    if (matches.length === 0) {
      throw new Error(
        `No documents match '${options.search.trim()}'. Run 'rulesync docs' to list documents.`,
      );
    }
    for (const match of matches) {
      printLine(`${match.id} — ${match.snippet}`);
    }
    logger.debug(`Found ${matches.length} matching document(s).`);
    return;
  }

  if (document === undefined) {
    for (const id of listDocuments()) {
      printLine(id);
    }
    return;
  }

  // Print verbatim (the embedded content already ends with a newline) so the
  // output can be piped to other tools.
  process.stdout.write(readDocument(document).content);
}
