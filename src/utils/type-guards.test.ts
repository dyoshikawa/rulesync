import { describe, expect, it } from "vitest";

import { isRecord } from "./type-guards.js";

describe("isRecord", () => {
  it("should return true for plain objects", () => {
    expect(isRecord({ foo: "bar" })).toBe(true);
    expect(isRecord({ a: 1, b: 2, c: 3 })).toBe(true);
  });

  it("should return true for empty objects", () => {
    expect(isRecord({})).toBe(true);
  });

  it("should return true for nested objects", () => {
    expect(isRecord({ nested: { deep: { value: 1 } } })).toBe(true);
  });

  it("should return true for objects with mixed value types", () => {
    expect(
      isRecord({
        string: "value",
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
        array: [1, 2, 3],
        object: { nested: true },
      }),
    ).toBe(true);
  });

  it("should return false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("should return false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
    expect(isRecord([{ foo: "bar" }])).toBe(false);
  });

  it("should return false for primitive types", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(false)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(Symbol("test"))).toBe(false);
    expect(isRecord(BigInt(123))).toBe(false);
  });

  it("should return true for class instances", () => {
    class TestClass {
      value = 1;
    }
    expect(isRecord(new TestClass())).toBe(true);
  });

  it("should return true for Object.create(null)", () => {
    const nullPrototypeObj = Object.create(null);
    nullPrototypeObj.foo = "bar";
    expect(isRecord(nullPrototypeObj)).toBe(true);
  });

  it("should return false for functions", () => {
    expect(isRecord(() => {})).toBe(false);
    expect(isRecord(function () {})).toBe(false);
    expect(
      isRecord(
        class {
          foo = 1;
        },
      ),
    ).toBe(false);
  });

  it("should return true for Date objects", () => {
    expect(isRecord(new Date())).toBe(true);
  });

  it("should return true for RegExp objects", () => {
    expect(isRecord(/test/)).toBe(true);
    expect(isRecord(new RegExp("test"))).toBe(true);
  });

  it("should return true for Map and Set objects", () => {
    expect(isRecord(new Map())).toBe(true);
    expect(isRecord(new Set())).toBe(true);
  });
});
