import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";

/**
 * Whether an imported permission rule names a reserved key (`__proto__`,
 * `constructor` or `prototype`) as its category or pattern, warning when it
 * does. Such a name would not land as a plain own key of the canonical
 * `permission` map, so the importers drop the rule; the warning makes the drop
 * visible, as `buildImportedHooksConfig` does for hook events.
 */
export function skipsReservedPermissionName({
  toolLabel,
  category,
  pattern,
  logger,
}: {
  toolLabel: string;
  category: string;
  pattern?: string;
  logger?: Logger;
}): boolean {
  if (
    !isPrototypePollutionKey(category) &&
    (pattern === undefined || !isPrototypePollutionKey(pattern))
  ) {
    return false;
  }
  const rule =
    pattern === undefined
      ? quoteValueForWarning(category)
      : `${quoteValueForWarning(category)} pattern ${quoteValueForWarning(pattern)}`;
  warnWithFallback(
    logger,
    `Skipping imported ${toolLabel} permission rule for ${rule}: reserved key names cannot be used as permission categories or patterns.`,
  );
  return true;
}
