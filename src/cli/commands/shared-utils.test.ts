import { describe, expect, it, vi } from "vitest";
import { resolveGlobPaths } from "./shared-utils.js";

vi.mock("node:path", () => ({
  isAbsolute: vi.fn((path: string) => path.startsWith("/")),
  resolve: vi.fn((path: string) => `/resolved${path}`),
}));

describe("shared-utils", () => {
  describe("resolveGlobPaths", () => {
    it("should return absolute paths as-is", () => {
      const paths = ["/absolute/path1", "/absolute/path2"];
      const result = resolveGlobPaths(paths);

      expect(result).toEqual(["/absolute/path1", "/absolute/path2"]);
    });

    it("should resolve relative paths", () => {
      const paths = ["relative/path1", "relative/path2"];
      const result = resolveGlobPaths(paths);

      expect(result).toEqual(["/resolvedrelative/path1", "/resolvedrelative/path2"]);
    });

    it("should handle mixed absolute and relative paths", () => {
      const paths = ["/absolute/path", "relative/path"];
      const result = resolveGlobPaths(paths);

      expect(result).toEqual(["/absolute/path", "/resolvedrelative/path"]);
    });

    it("should handle empty array", () => {
      const result = resolveGlobPaths([]);

      expect(result).toEqual([]);
    });

    it("should handle single path", () => {
      const result = resolveGlobPaths(["single/path"]);

      expect(result).toEqual(["/resolvedsingle/path"]);
    });
  });
});
