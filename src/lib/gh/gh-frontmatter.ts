import { dump, load } from "js-yaml";

const FRONTMATTER_FENCE = "---";

/**
 * Parses YAML frontmatter at the head of a SKILL.md, sets/overwrites the
 * three provenance keys (`source`, `repository`, `ref`), and re-serializes.
 *
 * If the file has no frontmatter block, a fresh one is prepended with only
 * the provenance keys + the original body. All other existing frontmatter
 * keys are preserved verbatim (the merge is a shallow object spread on the
 * loaded YAML).
 *
 * Throws `Error("invalid frontmatter")` when an `---` fenced block exists
 * but its body is not a YAML object (e.g. malformed YAML, or a list/scalar
 * at the top level). Callers may choose to fall back to "prepend fresh" on
 * this error, but the function itself does not silently rewrite — silently
 * dropping a corrupted frontmatter could destroy user metadata.
 */
export function injectSourceMetadata(params: {
  content: string;
  source: string;
  repository: string;
  ref: string;
}): string {
  const { content, source, repository, ref } = params;
  const provenance = { source, repository, ref };

  // Detect the opening fence in both LF (`---\n`) and CRLF (`---\r\n`) forms.
  // SKILL.md files authored on Windows or by editors that preserve CRLF must
  // round-trip cleanly — without this branch the existing frontmatter would
  // be buried inside a fresh provenance block on the first install.
  let openFenceLen: number;
  if (content.startsWith(`${FRONTMATTER_FENCE}\r\n`)) {
    openFenceLen = 5;
  } else if (content.startsWith(`${FRONTMATTER_FENCE}\n`)) {
    openFenceLen = 4;
  } else if (content === FRONTMATTER_FENCE) {
    openFenceLen = 3;
  } else {
    // No frontmatter block. Prepend a fresh one with just the provenance keys.
    const yaml = dump(provenance, { noRefs: true, lineWidth: -1, sortKeys: false });
    return `${FRONTMATTER_FENCE}\n${yaml}${FRONTMATTER_FENCE}\n${content}`;
  }

  // Body starts immediately after the opening fence.
  const afterOpen = content.substring(openFenceLen);

  // Closing fence forms we accept:
  //   - `---` immediately at the start of the body (i.e. `---\n---\n...`,
  //     which yields an empty frontmatter block).
  //   - `\n---` followed by a newline OR end-of-file (the trailing newline
  //     after the closing `---` is optional so the fence may sit at EOF).
  let fmBody: string;
  let rest: string;
  if (afterOpen.startsWith("---\n") || afterOpen.startsWith("---\r\n") || afterOpen === "---") {
    fmBody = "";
    const fenceLen = afterOpen.startsWith("---\r\n") ? 5 : afterOpen === "---" ? 3 : 4;
    rest = afterOpen.substring(fenceLen);
  } else {
    const match = /\n---(\r?\n|$)/.exec(afterOpen);
    if (!match) {
      // The file starts with `---\n` but there is no closing `---` line. We
      // refuse to guess where the frontmatter ends; treat as invalid so the
      // caller can decide whether to fall back.
      throw new Error("invalid frontmatter");
    }
    fmBody = afterOpen.substring(0, match.index);
    rest = afterOpen.substring(match.index + match[0].length);
  }

  let loaded: unknown;
  try {
    loaded = load(fmBody);
  } catch {
    throw new Error("invalid frontmatter");
  }

  if (loaded === null || loaded === undefined) {
    // Empty frontmatter block (`---\n---\n...`). Use only provenance.
    const yaml = dump(provenance, { noRefs: true, lineWidth: -1, sortKeys: false });
    return `${FRONTMATTER_FENCE}\n${yaml}${FRONTMATTER_FENCE}\n${rest}`;
  }
  if (typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new Error("invalid frontmatter");
  }

  // Shallow merge: existing keys preserved, provenance keys overwritten.
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const existing = loaded as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...existing,
    ...provenance,
  };
  const yaml = dump(merged, { noRefs: true, lineWidth: -1, sortKeys: false });
  return `${FRONTMATTER_FENCE}\n${yaml}${FRONTMATTER_FENCE}\n${rest}`;
}
