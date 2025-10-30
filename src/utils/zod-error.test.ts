import { describe, expect, it } from "vitest";
import { z } from "zod/mini";
import { formatZodError } from "./zod-error.js";

describe("formatZodError", () => {
  it("should format a single validation error without path", () => {
    const schema = z.string();
    const result = schema.safeParse(123);

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toBe("Invalid input");
    }
  });

  it("should format a single validation error with path", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.safeParse({ name: "John", age: "30" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("age:");
      expect(formatted).toContain("Invalid input");
    }
  });

  it("should format multiple validation errors", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      count: z.number(),
    });
    const result = schema.safeParse({ name: 123, age: "30", count: "invalid" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("name:");
      expect(formatted).toContain("age:");
      expect(formatted).toContain("count:");
      expect(formatted).toContain(";");
    }
  });

  it("should format nested path errors", () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          email: z.string(),
        }),
      }),
    });
    const result = schema.safeParse({ user: { profile: { email: 123 } } });

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("user.profile.email:");
    }
  });

  it("should handle enum validation errors", () => {
    const schema = z.enum(["foo", "bar"]);
    const result = schema.safeParse("baz");

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    }
  });

  it("should return human-readable format instead of JSON", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.safeParse({ name: 123, age: "30" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      // Should not be JSON format
      expect(formatted).not.toMatch(/^\[/);
      expect(formatted).not.toMatch(/^\{/);
      // Should be semicolon-separated
      expect(formatted).toMatch(/^[^;]+: [^;]+(; [^;]+: [^;]+)*$/);
    }
  });
});
