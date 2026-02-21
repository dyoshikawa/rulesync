import type { ParsedSource } from "../types/fetch.js";
import type { GitProvider } from "../types/git-provider.js";
import { ALL_GIT_PROVIDERS } from "../types/git-provider.js";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITLAB_HOSTS = new Set(["gitlab.com", "www.gitlab.com"]);

/**
 * Parse source specification into components
 * Supports:
 * - URL format: https://github.com/owner/repo, https://gitlab.com/owner/repo
 * - Prefix format: github:owner/repo, gitlab:owner/repo
 * - Shorthand format: owner/repo (defaults to GitHub)
 * - With ref: owner/repo@ref
 * - With path: owner/repo:path
 * - Combined: owner/repo@ref:path
 */
export function parseSource(source: string): ParsedSource {
  // Handle full URL format (https://...)
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return parseUrl(source);
  }

  // Handle prefix format (github:owner/repo, gitlab:owner/repo)
  if (source.includes(":") && !source.includes("://")) {
    const colonIndex = source.indexOf(":");
    const prefix = source.substring(0, colonIndex);
    const rest = source.substring(colonIndex + 1);

    // Check if prefix is a known provider using type guard
    const provider = ALL_GIT_PROVIDERS.find((p) => p === prefix);
    if (provider) {
      return { provider, ...parseShorthand(rest) };
    }

    // If prefix is not a known provider, treat the whole thing as shorthand
    // This handles cases like owner/repo:path where "owner/repo" contains no provider prefix
    return { provider: "github", ...parseShorthand(source) };
  }

  // Handle shorthand: owner/repo[@ref][:path] - defaults to GitHub
  return { provider: "github", ...parseShorthand(source) };
}

/**
 * Parse URL format into components
 */
function parseUrl(url: string): ParsedSource {
  const urlObj = new URL(url);
  const host = urlObj.hostname.toLowerCase();

  let provider: GitProvider;
  if (GITHUB_HOSTS.has(host)) {
    provider = "github";
  } else if (GITLAB_HOSTS.has(host)) {
    provider = "gitlab";
  } else {
    throw new Error(
      `Unknown Git provider for host: ${host}. Supported providers: ${ALL_GIT_PROVIDERS.join(", ")}`,
    );
  }

  // Split by path segments
  const segments = urlObj.pathname.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid ${provider} URL: ${url}. Expected format: https://${host}/owner/repo`);
  }

  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/, "");

  // Check for /tree/ref/path or /blob/ref/path pattern
  if (segments.length > 2 && (segments[2] === "tree" || segments[2] === "blob")) {
    const ref = segments[3];
    const path = segments.length > 4 ? segments.slice(4).join("/") : undefined;
    return {
      provider,
      owner: owner ?? "",
      repo: repo ?? "",
      ref,
      path,
    };
  }

  return {
    provider,
    owner: owner ?? "",
    repo: repo ?? "",
  };
}

/**
 * Parse shorthand format (without provider prefix)
 */
function parseShorthand(source: string): Omit<ParsedSource, "provider"> {
  // Pattern: owner/repo[@ref][:path]
  let remaining = source;
  let path: string | undefined;
  let ref: string | undefined;

  // Extract path first (after :)
  const colonIndex = remaining.indexOf(":");
  if (colonIndex !== -1) {
    path = remaining.substring(colonIndex + 1);
    if (!path) {
      throw new Error(`Invalid source: ${source}. Path cannot be empty after ":".`);
    }
    remaining = remaining.substring(0, colonIndex);
  }

  // Extract ref (after @)
  const atIndex = remaining.indexOf("@");
  if (atIndex !== -1) {
    ref = remaining.substring(atIndex + 1);
    if (!ref) {
      throw new Error(`Invalid source: ${source}. Ref cannot be empty after "@".`);
    }
    remaining = remaining.substring(0, atIndex);
  }

  // Parse owner/repo
  const slashIndex = remaining.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid source: ${source}. Expected format: owner/repo, owner/repo@ref, or owner/repo:path`,
    );
  }

  const owner = remaining.substring(0, slashIndex);
  const repo = remaining.substring(slashIndex + 1);

  if (!owner || !repo) {
    throw new Error(`Invalid source: ${source}. Both owner and repo are required.`);
  }

  return {
    owner,
    repo,
    ref,
    path,
  };
}
