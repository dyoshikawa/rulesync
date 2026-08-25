/**
 * Map over items with a bounded number of operations in flight.
 *
 * `Promise.all(items.map(...))` starts every operation at once, which is fine
 * for a handful of paths and not fine for a directory tree of unknown size: a
 * few thousand concurrent `realpath` calls queue on the libuv thread pool and
 * hold their closures alive while they wait. Results keep the input order.
 *
 * `withSemaphore` in `src/lib/github-utils.ts` bounds concurrency too, but it
 * wraps one call at a time: the caller still writes `Promise.all(items.map(…))`
 * around it, so every item's promise chain is allocated up front. This walks a
 * shared cursor with `limit` workers instead, so a list of unknown size costs
 * `limit` pending operations rather than one per item.
 */
export async function mapWithConcurrency<TItem, TResult>({
  items,
  limit,
  mapper,
}: {
  items: readonly TItem[];
  limit: number;
  mapper: (item: TItem) => Promise<TResult>;
}): Promise<TResult[]> {
  const results: TResult[] = Array.from({ length: items.length });
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await mapper(item);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}
