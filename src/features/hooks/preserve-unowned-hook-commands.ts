import type { Logger } from "../../utils/logger.js";
import {
  isPrototypePollutionKey,
  omitPrototypePollutionKeys,
} from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { type OwnedHookRef, ownedHookKey } from "./hooks-ownership-lock.js";

export type HookListShape = "matcher-groups" | "flat";

export type MergedHookLists = {
  /** The `hooks` value to write. */
  hooks: Record<string, unknown[]>;
  /**
   * Every handler this run generated, to be recorded in the ownership lock.
   * Preserved third-party handlers are deliberately absent: rulesync must not
   * claim, and therefore must never retract, a hook it did not write.
   */
  owned: OwnedHookRef[];
};

/**
 * Read the `hooks` value from a destination JSON file.
 *
 * `malformed` separates "the file has no hooks" from "the file could not be
 * read", so a caller that is about to preserve content can say out loud that
 * it is replacing a file it failed to parse.
 */
export function parseExistingHooksValue(existingContent: string): {
  hooks: unknown;
  malformed: boolean;
} {
  if (existingContent.trim() === "") {
    return { hooks: undefined, malformed: false };
  }
  try {
    const parsed: unknown = JSON.parse(existingContent);
    return { hooks: isPlainObject(parsed) ? parsed.hooks : undefined, malformed: false };
  } catch {
    return { hooks: undefined, malformed: true };
  }
}

/**
 * Produce the destination hooks list, optionally keeping handlers rulesync does
 * not own.
 *
 * Ownership is decided by `previouslyOwned` — the identities recorded in the
 * destination's ownership lock on the previous run — and never by guessing from
 * the command text. That is what makes removal work: a handler rulesync wrote
 * before and no longer generates is retracted, while a handler rulesync has
 * never written is left alone. Without a lock (the first run after opting in)
 * nothing is retracted, which is the non-destructive direction.
 *
 * Callers must pass the destination's shape. Plugin destinations are fully
 * owned by rulesync and must not call this.
 */
export function mergeGeneratedHookLists({
  existingContent,
  generatedHooks,
  shape,
  preserveUnowned,
  previouslyOwned,
  logger,
}: {
  existingContent: string;
  generatedHooks: Record<string, unknown[]>;
  shape: HookListShape;
  preserveUnowned: boolean;
  previouslyOwned?: ReadonlySet<string>;
  logger?: Logger;
}): MergedHookLists {
  const owned = collectOwnedRefs({ generatedHooks, shape });
  if (!preserveUnowned) {
    return { hooks: generatedHooks, owned };
  }
  const { hooks: existingHooks, malformed } = parseExistingHooksValue(existingContent);
  if (malformed) {
    logger?.warn(
      "Replacing hooks wholesale: the existing file is not valid JSON, so no third-party hook in it can be preserved.",
    );
  }
  return {
    hooks: preserveUnownedHookCommands({
      existingHooks,
      generatedHooks,
      shape,
      owned,
      previouslyOwned: previouslyOwned ?? new Set(),
      logger,
    }),
    owned,
  };
}

/**
 * Merge the destination's existing handlers into the generated set.
 *
 * Each existing handler falls into exactly one of three cases:
 * - this run generates it → the generated copy stands, the existing one is dropped;
 * - a previous run generated it and this one does not → it is retracted, with a warning;
 * - neither → it is unowned, and kept.
 */
export function preserveUnownedHookCommands({
  existingHooks,
  generatedHooks,
  shape,
  owned,
  previouslyOwned,
  logger,
}: {
  existingHooks: unknown;
  generatedHooks: Record<string, unknown[]>;
  shape: HookListShape;
  owned: readonly OwnedHookRef[];
  previouslyOwned: ReadonlySet<string>;
  logger?: Logger;
}): Record<string, unknown[]> {
  const result = cloneGeneratedHooks({ generatedHooks, shape });
  if (!isPlainObject(existingHooks)) {
    return result;
  }

  const seen = new Set(owned.map((ref) => ownedHookKey(ref)));

  for (const [event, existingValue] of Object.entries(existingHooks)) {
    if (isPrototypePollutionKey(event)) {
      continue;
    }
    if (!Array.isArray(existingValue)) {
      warnSkip({ logger, event, expected: "an array of hook entries" });
      continue;
    }
    const merged =
      shape === "matcher-groups"
        ? mergeMatcherGroups({
            existing: existingValue,
            generated: result[event] ?? [],
            event,
            seen,
            previouslyOwned,
            logger,
          })
        : mergeFlatHandlers({
            existing: existingValue,
            generated: result[event] ?? [],
            event,
            seen,
            previouslyOwned,
            logger,
          });
    if (merged.length === 0) {
      delete result[event];
    } else {
      result[event] = merged;
    }
  }

  return result;
}

function cloneGeneratedHooks({
  generatedHooks,
  shape,
}: {
  generatedHooks: Record<string, unknown[]>;
  shape: HookListShape;
}): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = Object.create(null);
  for (const [event, value] of Object.entries(generatedHooks)) {
    if (isPrototypePollutionKey(event) || !Array.isArray(value)) {
      continue;
    }
    result[event] =
      shape === "matcher-groups"
        ? value.map((group) => cloneMatcherGroup(group))
        : value.map((handler) => cloneHandler(handler));
  }
  return result;
}

/** The identities of every handler in the generated set, in destination order. */
function collectOwnedRefs({
  generatedHooks,
  shape,
}: {
  generatedHooks: Record<string, unknown[]>;
  shape: HookListShape;
}): OwnedHookRef[] {
  const owned: OwnedHookRef[] = [];
  for (const [event, value] of Object.entries(generatedHooks)) {
    if (isPrototypePollutionKey(event) || !Array.isArray(value)) {
      continue;
    }
    if (shape === "flat") {
      for (const handler of value) {
        if (isPlainObject(handler)) {
          owned.push({ event, identity: handlerIdentity(handler) });
        }
      }
      continue;
    }
    for (const group of value) {
      if (!isMatcherGroup(group)) {
        continue;
      }
      const matcher = matcherKey(group.matcher);
      for (const handler of group.hooks) {
        if (isPlainObject(handler)) {
          owned.push({ event, matcher, identity: handlerIdentity(handler) });
        }
      }
    }
  }
  return owned;
}

/**
 * The merge keeps every existing handler where it is. Some tools key state by
 * position — Codex CLI persists a hook's trust review under its event, matcher
 * group index and handler index — so moving a handler the user already
 * reviewed would silently change which hook that review belongs to. Hence:
 * - an existing handler this run generates is updated in place;
 * - an unowned existing handler stays in place;
 * - a newly generated handler is appended to the first existing group with its
 *   matcher, or in a new group after the existing ones.
 *
 * A retracted handler, or a group left empty by retractions, is still removed,
 * which shifts whatever follows it in the same list; that is unavoidable
 * without leaving a placeholder behind.
 */
function mergeMatcherGroups({
  existing,
  generated,
  event,
  seen,
  previouslyOwned,
  logger,
}: {
  existing: unknown[];
  generated: unknown[];
  event: string;
  seen: Set<string>;
  previouslyOwned: ReadonlySet<string>;
  logger: Logger | undefined;
}): unknown[] {
  const pending = createPendingGenerated();
  for (const group of generated) {
    if (isMatcherGroup(group)) {
      addPending({ pending, handlers: group.hooks, event, matcher: matcherKey(group.matcher) });
    }
  }

  const merged: unknown[] = [];
  const homes = new Map<string, MatcherGroup>();
  for (const group of existing) {
    if (!isMatcherGroup(group)) {
      warnSkip({ logger, event, expected: "a matcher group" });
      continue;
    }
    const matcher = matcherKey(group.matcher);
    const hooks = keepExistingHandlers({
      handlers: group.hooks,
      event,
      matcher,
      pending,
      seen,
      previouslyOwned,
      logger,
    });
    if (hooks.length === 0) {
      continue;
    }
    // Group-level keys other than `hooks` (a Factory Droid `commandRegex`,
    // say) belong to the group, so they stay with it.
    const kept: MatcherGroup = { ...omitPrototypePollutionKeys(group), hooks };
    merged.push(kept);
    if (!homes.has(matcher)) {
      homes.set(matcher, kept);
    }
  }

  for (const group of generated) {
    if (!isMatcherGroup(group)) {
      merged.push(group);
      continue;
    }
    const remaining = group.hooks.filter((handler) => !pending.placed.has(handler));
    if (remaining.length === 0) {
      continue;
    }
    const home = homes.get(matcherKey(group.matcher));
    if (home === undefined) {
      merged.push({ ...group, hooks: remaining });
    } else {
      home.hooks.push(...remaining);
    }
  }

  return merged;
}

/** The flat-list counterpart of {@link mergeMatcherGroups}, with the same positional rules. */
function mergeFlatHandlers({
  existing,
  generated,
  event,
  seen,
  previouslyOwned,
  logger,
}: {
  existing: unknown[];
  generated: unknown[];
  event: string;
  seen: Set<string>;
  previouslyOwned: ReadonlySet<string>;
  logger: Logger | undefined;
}): unknown[] {
  const pending = createPendingGenerated();
  addPending({ pending, handlers: generated, event, matcher: undefined });

  const flat: unknown[] = [];
  for (const handler of existing) {
    if (isMatcherGroup(handler)) {
      warnSkip({ logger, event, expected: "a flat handler" });
      continue;
    }
    flat.push(handler);
  }
  const merged = keepExistingHandlers({
    handlers: flat,
    event,
    matcher: undefined,
    pending,
    seen,
    previouslyOwned,
    logger,
  });
  merged.push(...generated.filter((handler) => !pending.placed.has(handler)));
  return merged;
}

/**
 * Generated handlers of one event waiting for a position: `byKey` queues them
 * by ownership key, and `placed` records the ones an existing handler's slot
 * has already taken, so only the rest are appended.
 */
type PendingGenerated = {
  byKey: Map<string, unknown[]>;
  placed: Set<unknown>;
};

function createPendingGenerated(): PendingGenerated {
  return { byKey: new Map(), placed: new Set() };
}

function addPending({
  pending,
  handlers,
  event,
  matcher,
}: {
  pending: PendingGenerated;
  handlers: unknown[];
  event: string;
  matcher: string | undefined;
}): void {
  for (const handler of handlers) {
    if (!isPlainObject(handler)) {
      continue;
    }
    const key = ownedHookKey({ event, matcher, identity: handlerIdentity(handler) });
    const queue = pending.byKey.get(key);
    if (queue === undefined) {
      pending.byKey.set(key, [handler]);
    } else {
      queue.push(handler);
    }
  }
}

/**
 * Walk one existing list in order and decide each handler: replaced in place
 * by its generated copy, kept as unowned, or dropped (retracted or duplicate).
 */
function keepExistingHandlers({
  handlers,
  event,
  matcher,
  pending,
  seen,
  previouslyOwned,
  logger,
}: {
  handlers: unknown[];
  event: string;
  matcher: string | undefined;
  pending: PendingGenerated;
  seen: Set<string>;
  previouslyOwned: ReadonlySet<string>;
  logger: Logger | undefined;
}): unknown[] {
  const kept: unknown[] = [];
  for (const handler of handlers) {
    if (isPlainObject(handler)) {
      const key = ownedHookKey({ event, matcher, identity: handlerIdentity(handler) });
      const generated = pending.byKey.get(key)?.shift();
      if (generated !== undefined) {
        pending.placed.add(generated);
        kept.push(generated);
        continue;
      }
    }
    if (shouldPreserve({ handler, event, matcher, seen, previouslyOwned, logger })) {
      kept.push(cloneHandler(handler));
    }
  }
  return kept;
}

type MatcherGroup = {
  matcher?: unknown;
  hooks: unknown[];
};

function isMatcherGroup(value: unknown): value is MatcherGroup {
  return isPlainObject(value) && Array.isArray(value.hooks);
}

function cloneMatcherGroup(group: unknown): unknown {
  if (!isMatcherGroup(group)) {
    return cloneHandler(group);
  }
  return { ...group, hooks: group.hooks.map((handler) => cloneHandler(handler)) };
}

function cloneHandler(handler: unknown): unknown {
  return isPlainObject(handler) ? omitPrototypePollutionKeys(handler) : handler;
}

/**
 * Decide one existing handler, and remember it so an exact duplicate later in
 * the same event is not appended twice.
 */
function shouldPreserve({
  handler,
  event,
  matcher,
  seen,
  previouslyOwned,
  logger,
}: {
  handler: unknown;
  event: string;
  matcher: string | undefined;
  seen: Set<string>;
  previouslyOwned: ReadonlySet<string>;
  logger: Logger | undefined;
}): boolean {
  if (!isPlainObject(handler)) {
    warnSkip({ logger, event, expected: "a hook object" });
    return false;
  }
  const identity = handlerIdentity(handler);
  const key = ownedHookKey({ event, matcher, identity });
  if (seen.has(key)) {
    return false;
  }
  if (previouslyOwned.has(key)) {
    logger?.warn(`Removing hook rulesync no longer generates on ${event}: ${identity}`);
    return false;
  }
  seen.add(key);
  logger?.warn(`Preserving unowned hook on ${event}: ${identity}`);
  return true;
}

/**
 * A handler's identity is its action, not its whole shape: two entries running
 * the same command are the same hook even if their timeouts differ, so the
 * generated one replaces the existing one instead of doubling it. Shapes with
 * no recognizable action fall back to their full structure, which keeps them
 * comparable across runs — the alternative, no identity at all, made them
 * accumulate on every generate.
 */
function handlerIdentity(handler: Record<string, unknown>): string {
  const type = typeof handler.type === "string" ? handler.type : inferredType(handler);
  switch (type) {
    case "http":
      return taggedIdentity("http", handler.url) ?? structuralIdentity(handler);
    case "mcp_tool":
      return mcpToolIdentity(handler) ?? structuralIdentity(handler);
    case "prompt":
    case "agent":
      return taggedIdentity(type, handler.prompt) ?? structuralIdentity(handler);
    case "function":
      return taggedIdentity("function", handler.name) ?? structuralIdentity(handler);
    default:
      return (
        taggedIdentity("command", handler.command) ??
        taggedIdentity("prompt", handler.prompt) ??
        structuralIdentity(handler)
      );
  }
}

function inferredType(handler: Record<string, unknown>): string {
  return typeof handler.url === "string" ? "http" : "command";
}

function taggedIdentity(kind: string, value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? `${kind}:${value}` : undefined;
}

function mcpToolIdentity(handler: Record<string, unknown>): string | undefined {
  const server = typeof handler.server === "string" ? handler.server : "";
  const tool = typeof handler.tool === "string" ? handler.tool : "";
  if (server === "" && tool === "") {
    return undefined;
  }
  // `input` is part of what the hook does, so two calls to the same tool with
  // different arguments are different hooks.
  return `mcp_tool:${server}:${tool}:${stableStringify(handler.input)}`;
}

function structuralIdentity(handler: Record<string, unknown>): string {
  return `json:${stableStringify(handler)}`;
}

/** Key-order-independent JSON, so an identity survives a rewritten file. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([key]) => !isPrototypePollutionKey(key))
      .toSorted(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Matcher groups are matched by the whole matcher value, not just strings: a
 * non-string matcher is a shape rulesync does not emit, and collapsing every
 * such group onto one key would merge unrelated third-party groups together.
 */
function matcherKey(matcher: unknown): string {
  return matcher === undefined ? "" : stableStringify(matcher);
}

function warnSkip({
  logger,
  event,
  expected,
}: {
  logger: Logger | undefined;
  event: string;
  expected: string;
}): void {
  logger?.warn(`Skipping existing hook entry on ${event}: expected ${expected}`);
}
