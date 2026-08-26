import { type Node, type ParseError, parse, parseTree, printParseErrorCode } from "jsonc-parser";

import { PROTOTYPE_POLLUTION_KEYS } from "./prototype-pollution.js";

/**
 * Rebuild the parsed value from its own enumerable entries, dropping
 * prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
 * `jsonc-parser` assigns keys with plain `obj[key] = value` semantics, so a
 * literal `__proto__` key would replace the containing object's prototype
 * instead of becoming an own property; rebuilding gives every object a clean
 * `Object.prototype` again and severs that path.
 */
function deepSanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepSanitize(item));
  }
  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      sanitized[key] = deepSanitize(entry);
    }
    return sanitized;
  }
  return value;
}

/**
 * Collect the paths of every prototype-pollution key in the document, walking
 * the syntax tree rather than the parsed value.
 *
 * The parsed value cannot answer this question. `obj["__proto__"] = "deny"` is
 * discarded by the engine outright, and `obj["__proto__"] = {...}` replaces the
 * prototype instead of adding an own property — either way the key is already
 * gone by the time {@link deepSanitize} could look for it. Only the source text
 * still knows the user wrote it.
 *
 * A pollution key's subtree is not descended into, matching
 * {@link deepSanitize}, which drops the whole value along with the key.
 */
function collectPollutionKeyPaths({
  node,
  path,
  found,
}: {
  node: Node;
  path: string;
  found: string[];
}): void {
  if (node.type === "array") {
    for (const [index, child] of (node.children ?? []).entries()) {
      collectPollutionKeyPaths({ node: child, path: `${path}[${index}]`, found });
    }
    return;
  }
  if (node.type !== "object") {
    return;
  }
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (typeof keyNode?.value !== "string") {
      continue;
    }
    const keyPath = path === "" ? keyNode.value : `${path}.${keyNode.value}`;
    if (PROTOTYPE_POLLUTION_KEYS.has(keyNode.value)) {
      found.push(keyPath);
      continue;
    }
    if (valueNode !== undefined) {
      collectPollutionKeyPaths({ node: valueNode, path: keyPath, found });
    }
  }
}

/**
 * Parse a JSONC (JSON with Comments) document strictly.
 *
 * Unlike `jsonc-parser`'s bare `parse` (which silently tolerates syntax
 * errors and returns a best-effort value), this throws on any parse error so
 * a malformed source file fails loudly instead of generating half-empty tool
 * configs. Plain JSON is valid JSONC, so this is a drop-in replacement for
 * `JSON.parse` on files that may contain comments or trailing commas.
 */
export function parseJsonc(content: string): unknown {
  return parseJsoncReportingDroppedKeys({ content }).value;
}

/**
 * The same parse as {@link parseJsonc}, additionally reporting which
 * prototype-pollution keys were removed, as dotted paths
 * (`permission.bash.__proto__`).
 *
 * The parse itself is identical — the paths only let a caller tell the user
 * about entries that vanished, which they would otherwise have to notice by
 * comparing their source file against the generated output.
 */
export function parseJsoncReportingDroppedKeys({ content }: { content: string }): {
  value: unknown;
  droppedKeys: string[];
} {
  const errors: ParseError[] = [];
  const result: unknown = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join(", ");
    // SyntaxError keeps parity with JSON.parse, which callers historically
    // relied on for malformed-content handling.
    throw new SyntaxError(`Failed to parse JSONC content: ${details}`);
  }
  const droppedKeys: string[] = [];
  const tree = parseTree(content, [], { allowTrailingComma: true, disallowComments: false });
  if (tree !== undefined) {
    collectPollutionKeyPaths({ node: tree, path: "", found: droppedKeys });
  }
  return { value: deepSanitize(result), droppedKeys };
}
