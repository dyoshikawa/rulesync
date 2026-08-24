/**
 * Map over items with a bounded number of operations in flight.
 *
 * `Promise.all(items.map(...))` starts every operation at once, which is fine
 * for a handful of paths and not fine for a directory tree of unknown size: a
 * few thousand concurrent `realpath` calls queue on the libuv thread pool and
 * hold their closures alive while they wait. Results keep the input order.
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
