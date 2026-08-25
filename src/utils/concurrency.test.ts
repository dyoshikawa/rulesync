import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("should keep the input order in the results", async () => {
    const results = await mapWithConcurrency({
      items: [1, 2, 3, 4, 5],
      limit: 2,
      mapper: async (item) => item * 2,
    });

    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("should never run more than the limit at once", async () => {
    let inFlight = 0;
    let peakInFlight = 0;

    await mapWithConcurrency({
      items: Array.from({ length: 20 }, (_value, index) => index),
      limit: 3,
      mapper: async (item) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return item;
      },
    });

    expect(peakInFlight).toBeLessThanOrEqual(3);
  });

  it("should return an empty array for no items", async () => {
    const results = await mapWithConcurrency({
      items: [],
      limit: 4,
      mapper: async (item: number) => item,
    });

    expect(results).toEqual([]);
  });
});
