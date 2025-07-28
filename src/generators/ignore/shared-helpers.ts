import type { ParsedRule } from "../../types/index.js";

/**
 * Extract ignore patterns from rules for AI tools
 */
export function extractIgnorePatternsFromRules(rules: ParsedRule[]): string[] {
  const patterns: string[] = [];

  for (const rule of rules) {
    // Extract ignore patterns from rule globs
    if (rule.frontmatter.globs && rule.frontmatter.globs.length > 0) {
      for (const glob of rule.frontmatter.globs) {
        // Convert globs to ignore patterns where appropriate for AI exclusion
        if (shouldExcludeFromAI(glob)) {
          patterns.push(`# Exclude: ${rule.frontmatter.description}`);
          patterns.push(glob);
        }
      }
    }

    // Look for explicit ignore patterns in rule content
    const contentPatterns = extractIgnorePatternsFromContent(rule.content);
    patterns.push(...contentPatterns);
  }

  return patterns;
}

/**
 * Determine if a glob pattern should be excluded from AI access
 */
export function shouldExcludeFromAI(glob: string): boolean {
  const excludePatterns = [
    // Large generated files that slow indexing
    "**/assets/generated/**",
    "**/public/build/**",

    // Test fixtures with potentially sensitive data
    "**/tests/fixtures/**",
    "**/test/fixtures/**",
    "**/*.fixture.*",

    // Build outputs that provide little value for AI context
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",

    // Configuration that might contain sensitive data
    "**/config/production/**",
    "**/config/secrets/**",
    "**/config/prod/**",
    "**/deploy/prod/**",
    "**/*.prod.*",

    // Internal documentation that might be sensitive
    "**/internal/**",
    "**/internal-docs/**",
    "**/proprietary/**",
    "**/personal-notes/**",
    "**/private/**",
    "**/confidential/**",
  ];

  return excludePatterns.some((pattern) => {
    // Simple pattern matching for common cases
    const regex = new RegExp(pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"));
    return regex.test(glob);
  });
}

/**
 * Extract ignore patterns from rule content for AI tools
 */
export function extractIgnorePatternsFromContent(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Look for explicit ignore patterns in content
    if (trimmed.startsWith("# IGNORE:") || trimmed.startsWith("# aiignore:")) {
      const pattern = trimmed.replace(/^# (IGNORE|aiignore):\s*/, "").trim();
      if (pattern) {
        patterns.push(pattern);
      }
    }

    // Look for AugmentCode-specific ignore patterns
    if (trimmed.startsWith("# AUGMENT_IGNORE:") || trimmed.startsWith("# augmentignore:")) {
      const pattern = trimmed.replace(/^# (AUGMENT_IGNORE|augmentignore):\s*/, "").trim();
      if (pattern) {
        patterns.push(pattern);
      }
    }

    // Look for re-inclusion patterns (negation with !)
    if (trimmed.startsWith("# AUGMENT_INCLUDE:") || trimmed.startsWith("# augmentinclude:")) {
      const pattern = trimmed.replace(/^# (AUGMENT_INCLUDE|augmentinclude):\s*/, "").trim();
      if (pattern) {
        patterns.push(`!${pattern}`);
      }
    }

    // Look for common ignore patterns mentioned in content
    if (trimmed.includes("exclude") || trimmed.includes("ignore")) {
      const matches = trimmed.match(/['"`]([^'"`]+\.(log|tmp|cache|temp))['"`]/g);
      if (matches) {
        patterns.push(...matches.map((m) => m.replace(/['"`]/g, "")));
      }
    }
  }

  return patterns;
}

/**
 * Extract ignore patterns specific to AugmentCode from rule content
 */
export function extractAugmentCodeIgnorePatternsFromContent(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Look for AugmentCode-specific ignore patterns
    if (trimmed.startsWith("# AUGMENT_IGNORE:") || trimmed.startsWith("# augmentignore:")) {
      const pattern = trimmed.replace(/^# (AUGMENT_IGNORE|augmentignore):\s*/, "").trim();
      if (pattern) {
        patterns.push(pattern);
      }
    }

    // Look for re-inclusion patterns (negation with !)
    if (trimmed.startsWith("# AUGMENT_INCLUDE:") || trimmed.startsWith("# augmentinclude:")) {
      const pattern = trimmed.replace(/^# (AUGMENT_INCLUDE|augmentinclude):\s*/, "").trim();
      if (pattern) {
        patterns.push(`!${pattern}`);
      }
    }

    // Look for performance-related exclusions mentioned in content
    if (trimmed.includes("large file") || trimmed.includes("binary") || trimmed.includes("media")) {
      const matches = trimmed.match(/['"`]([^'"`]+\.(mp4|avi|zip|tar\.gz|rar|pdf|doc|xlsx))['"`]/g);
      if (matches) {
        patterns.push(...matches.map((m) => m.replace(/['"`]/g, "")));
      }
    }
  }

  return patterns;
}

/**
 * Determine if a glob pattern should be excluded specifically from AugmentCode indexing
 */
export function shouldExcludeFromAugmentCode(glob: string): boolean {
  return shouldExcludeFromAI(glob);
}