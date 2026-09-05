import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";

export type HookListShape = "matcher-groups" | "flat";

/**
 * Read the `hooks` value from a dest JSON file. Empty and invalid files yield
 * `undefined`, so generate still writes the generated set.
 */
export function parseExistingHooksValue(existingContent: string): unknown {
  try {
    const parsed: unknown = existingContent.trim() === "" ? {} : JSON.parse(existingContent);
    return isPlainObject(parsed) ? parsed.hooks : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Replace the dest hooks list, or merge unowned existing handlers when
 * `preserveUnowned` is set in `.rulesync/hooks.jsonc`.
 */
export function mergeGeneratedHookLists({
  existingContent,
  generatedHooks,
  shape,
  preserveUnowned,
  logger,
}: {
  existingContent: string;
  generatedHooks: Record<string, unknown[]>;
  shape: HookListShape;
  preserveUnowned: boolean;
  logger?: Logger;
}): Record<string, unknown[]> {
  if (!preserveUnowned) {
    return generatedHooks;
  }
  return preserveUnownedHookCommands({
    existingHooks: parseExistingHooksValue(existingContent),
    generatedHooks,
    shape,
    logger,
  });
}

/**
 * Keep dest handlers that the generated set does not own.
 *
 * A handler is owned when its type-aware identity is already in the generated
 * set for that event, or when its command refers to `.rulesync/hooks` (a stale
 * rulesync write). Identity is command / url / server+tool / prompt. Import is
 * unchanged. Callers must pass the dest shape; plugin dests should not call this.
 */
export function preserveUnownedHookCommands({
  existingHooks,
  generatedHooks,
  shape,
  logger,
}: {
  existingHooks: unknown;
  generatedHooks: Record<string, unknown[]>;
  shape: HookListShape;
  logger?: Logger;
}): Record<string, unknown[]> {
  if (!isPlainObject(existingHooks)) {
    return generatedHooks;
  }

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

  for (const [event, existingValue] of Object.entries(existingHooks)) {
    if (isPrototypePollutionKey(event) || !Array.isArray(existingValue)) {
      continue;
    }
    const generatedValue = Object.hasOwn(result, event) ? result[event] : undefined;
    const generatedList = Array.isArray(generatedValue) ? generatedValue : [];
    const merged =
      shape === "matcher-groups"
        ? mergeMatcherGroups({
            existing: existingValue,
            generated: generatedList,
            event,
            logger,
          })
        : mergeFlatHandlers({
            existing: existingValue,
            generated: generatedList,
            event,
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

function mergeMatcherGroups({
  existing,
  generated,
  event,
  logger,
}: {
  existing: unknown[];
  generated: unknown[];
  event: string;
  logger: Logger | undefined;
}): unknown[] {
  const merged = generated.map((group) => cloneMatcherGroup(group));
  const owned = identitiesIn(merged, { matcherGroups: true });

  for (const group of existing) {
    if (!isMatcherGroup(group)) {
      warnSkip({ logger, event, expected: "a matcher group" });
      continue;
    }
    const leftovers = group.hooks.filter((handler) => shouldPreserve({ handler, owned }));
    if (leftovers.length === 0) {
      continue;
    }
    const matcher = matcherKey(group.matcher);
    const target = merged.find(
      (candidate) => isMatcherGroup(candidate) && matcherKey(candidate.matcher) === matcher,
    );
    const clonedLeftovers = leftovers.map((handler) => cloneHandler(handler));
    if (target !== undefined && isMatcherGroup(target)) {
      target.hooks.push(...clonedLeftovers);
    } else {
      merged.push({ ...group, hooks: clonedLeftovers });
    }
    for (const handler of leftovers) {
      rememberOwned({ handler, owned });
      warnPreserved({ logger, event, handler });
    }
  }

  return merged;
}

function mergeFlatHandlers({
  existing,
  generated,
  event,
  logger,
}: {
  existing: unknown[];
  generated: unknown[];
  event: string;
  logger: Logger | undefined;
}): unknown[] {
  const owned = identitiesIn(generated, { matcherGroups: false });
  const leftovers: unknown[] = [];
  for (const handler of existing) {
    if (isMatcherGroup(handler)) {
      warnSkip({ logger, event, expected: "a flat handler" });
      continue;
    }
    if (!shouldPreserve({ handler, owned })) {
      continue;
    }
    leftovers.push(cloneHandler(handler));
    rememberOwned({ handler, owned });
    warnPreserved({ logger, event, handler });
  }
  if (leftovers.length === 0) {
    return generated.map((handler) => cloneHandler(handler));
  }
  return [...generated, ...leftovers];
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
  return isPlainObject(handler) ? { ...handler } : handler;
}

function identitiesIn(
  values: unknown[],
  { matcherGroups }: { matcherGroups: boolean },
): Set<string> {
  const owned = new Set<string>();
  for (const value of values) {
    const handlers = matcherGroups && isMatcherGroup(value) ? value.hooks : [value];
    for (const handler of handlers) {
      rememberOwned({ handler, owned });
    }
  }
  return owned;
}

function rememberOwned({ handler, owned }: { handler: unknown; owned: Set<string> }): void {
  const identity = handlerIdentity(handler);
  if (identity !== undefined) {
    owned.add(identity);
  }
}

function shouldPreserve({ handler, owned }: { handler: unknown; owned: Set<string> }): boolean {
  if (isStaleRulesyncCommand(handler)) {
    return false;
  }
  const identity = handlerIdentity(handler);
  if (identity === undefined) {
    return isPlainObject(handler);
  }
  return !owned.has(identity);
}

function isStaleRulesyncCommand(handler: unknown): boolean {
  return (
    isPlainObject(handler) &&
    typeof handler.command === "string" &&
    handler.command.includes(".rulesync/hooks")
  );
}

function handlerIdentity(handler: unknown): string | undefined {
  if (!isPlainObject(handler)) {
    return undefined;
  }
  const type = typeof handler.type === "string" ? handler.type : undefined;
  if (type === "http" || (type === undefined && typeof handler.url === "string")) {
    if (typeof handler.url === "string" && handler.url !== "") {
      return `http:${handler.url}`;
    }
    return undefined;
  }
  if (type === "mcp_tool") {
    const server = typeof handler.server === "string" ? handler.server : "";
    const tool = typeof handler.tool === "string" ? handler.tool : "";
    return server !== "" || tool !== "" ? `mcp_tool:${server}:${tool}` : undefined;
  }
  if (type === "prompt" || type === "agent") {
    return typeof handler.prompt === "string" && handler.prompt !== ""
      ? `${type}:${handler.prompt}`
      : undefined;
  }
  if (typeof handler.command === "string" && handler.command !== "") {
    return `command:${handler.command}`;
  }
  if (typeof handler.prompt === "string" && handler.prompt !== "") {
    return `prompt:${handler.prompt}`;
  }
  return undefined;
}

function matcherKey(matcher: unknown): string {
  if (matcher === undefined) {
    return "undefined-matcher";
  }
  return typeof matcher === "string" ? `s:${matcher}` : "other";
}

function warnPreserved({
  logger,
  event,
  handler,
}: {
  logger: Logger | undefined;
  event: string;
  handler: unknown;
}): void {
  if (logger === undefined) {
    return;
  }
  logger.warn(
    `Preserving unowned hook on ${event}: ${handlerIdentity(handler) ?? "untyped handler"}`,
  );
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
  if (logger === undefined) {
    return;
  }
  logger.warn(`Skipping existing hook entry on ${event}: expected ${expected}`);
}
