import { describe, expect, it } from "vitest";

import { parseSource } from "./source-parser.js";

describe("parseSource", () => {
  describe("GitHub URL parsing", () => {
    it("should parse basic GitHub URL", () => {
      const result = parseSource("https://github.com/owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse GitHub URL with /tree/branch", () => {
      const result = parseSource("https://github.com/owner/repo/tree/main");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: undefined,
      });
    });

    it("should parse GitHub URL with /tree/branch/path", () => {
      const result = parseSource("https://github.com/owner/repo/tree/develop/packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "develop",
        path: "packages/frontend",
      });
    });

    it("should parse GitHub URL with /blob/branch/path", () => {
      const result = parseSource("https://github.com/owner/repo/blob/main/src/index.ts");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "src/index.ts",
      });
    });

    it("should strip .git suffix from repo name", () => {
      const result = parseSource("https://github.com/owner/repo.git");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse www.github.com URL", () => {
      const result = parseSource("https://www.github.com/owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should throw error for invalid GitHub URL", () => {
      expect(() => parseSource("https://github.com/owner")).toThrow(/Invalid github URL/);
    });
  });

  describe("GitLab URL parsing", () => {
    it("should parse basic GitLab URL", () => {
      const result = parseSource("https://gitlab.com/owner/repo");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse GitLab URL with /tree/branch", () => {
      const result = parseSource("https://gitlab.com/owner/repo/tree/main");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: undefined,
      });
    });

    it("should parse www.gitlab.com URL", () => {
      const result = parseSource("https://www.gitlab.com/owner/repo");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("prefix format parsing", () => {
    it("should parse github:owner/repo", () => {
      const result = parseSource("github:owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse gitlab:owner/repo", () => {
      const result = parseSource("gitlab:owner/repo");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse github:owner/repo@ref", () => {
      const result = parseSource("github:owner/repo@v1.0.0");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
      });
    });

    it("should parse gitlab:owner/repo:path", () => {
      const result = parseSource("gitlab:owner/repo:subdir");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
        path: "subdir",
      });
    });

    it("should parse github:owner/repo@ref:path", () => {
      const result = parseSource("github:owner/repo@main:packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "packages/frontend",
      });
    });
  });

  describe("shorthand parsing", () => {
    it("should parse basic owner/repo (defaults to github)", () => {
      const result = parseSource("owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse owner/repo@ref", () => {
      const result = parseSource("owner/repo@main");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
      });
    });

    it("should parse owner/repo:path", () => {
      const result = parseSource("owner/repo:packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        path: "packages/frontend",
      });
    });

    it("should parse owner/repo@ref:path", () => {
      const result = parseSource("owner/repo@v1.0.0:packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
        path: "packages/frontend",
      });
    });

    it("should throw error for invalid shorthand", () => {
      expect(() => parseSource("invalid")).toThrow(/Invalid source/);
    });

    it("should throw error for empty owner or repo", () => {
      expect(() => parseSource("/repo")).toThrow(/Invalid source/);
      expect(() => parseSource("owner/")).toThrow(/Invalid source/);
    });

    it("should throw error for empty ref after @", () => {
      expect(() => parseSource("owner/repo@")).toThrow(/Ref cannot be empty/);
    });

    it("should throw error for empty path after :", () => {
      expect(() => parseSource("owner/repo:")).toThrow(/Path cannot be empty/);
    });
  });

  describe("unknown provider handling", () => {
    it("should throw error for unknown URL host", () => {
      expect(() => parseSource("https://bitbucket.org/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });

    it("should reject subdomain spoofing attempts for GitHub", () => {
      expect(() => parseSource("https://phishing.github.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
      expect(() => parseSource("https://evil.github.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });

    it("should reject subdomain spoofing attempts for GitLab", () => {
      expect(() => parseSource("https://phishing.gitlab.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
      expect(() => parseSource("https://evil.gitlab.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });

    it("should reject suffix spoofing attempts", () => {
      expect(() => parseSource("https://notgithub.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
      expect(() => parseSource("https://notgitlab.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });
  });
});
