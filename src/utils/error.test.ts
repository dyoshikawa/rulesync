import { describe, expect, it } from "vitest";
import { z } from "zod/mini";
import { formatError } from "./error.js";

describe("formatError", () => {
  it("should format a single validation error without path", () => {
    const schema = z.string();
    const result = schema.safeParse(123);

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatError(result.error);
      expect(formatted).toContain("Invalid input");
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
      const formatted = formatError(result.error);
      expect(formatted).toContain("Zod raw error:");
      expect(formatted).toContain("age");
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
      const formatted = formatError(result.error);
      expect(formatted).toContain("Zod raw error:");
      expect(formatted).toContain("name");
      expect(formatted).toContain("age");
      expect(formatted).toContain("count");
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
      const formatted = formatError(result.error);
      expect(formatted).toContain("Zod raw error:");
      expect(formatted).toContain("user");
      expect(formatted).toContain("email");
    }
  });

  it("should handle enum validation errors", () => {
    const schema = z.enum(["foo", "bar"]);
    const result = schema.safeParse("baz");

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatError(result.error);
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    }
  });

  it("should return JSON format for ZodError", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.safeParse({ name: 123, age: "30" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatError(result.error);
      // Should be JSON format with "Zod raw error:" prefix
      expect(formatted).toContain("Zod raw error:");
      expect(formatted).toContain("[");
      expect(formatted).toContain("]");
    }
  });

  it("should format standard Error with name and message", () => {
    const error = new Error("Something went wrong");
    const formatted = formatError(error);
    expect(formatted).toBe("Error: Something went wrong");
  });

  it("should format custom Error subclass with name and message", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("Custom error occurred");
    const formatted = formatError(error);
    expect(formatted).toBe("CustomError: Custom error occurred");
  });

  it("should convert string to string", () => {
    const formatted = formatError("Simple error string");
    expect(formatted).toBe("Simple error string");
  });

  it("should convert number to string", () => {
    const formatted = formatError(42);
    expect(formatted).toBe("42");
  });

  it("should convert null to string", () => {
    const formatted = formatError(null);
    expect(formatted).toBe("null");
  });

  it("should convert undefined to string", () => {
    const formatted = formatError(undefined);
    expect(formatted).toBe("undefined");
  });

  it("should convert object to string", () => {
    const formatted = formatError({ foo: "bar" });
    expect(formatted).toBe("[object Object]");
  });
});
