import type { ParsedRule } from "../../types/index.js";

/**
 * Extract ignore patterns from rules for AI tools
 */
export function extractIgnorePatternsFromRules(rules: ParsedRule[]): string[] {
  const patterns: string[] = [];

  for (const rule of rules) {
    // Extract ignore patterns from rule globs (only sensitive ones)
    if (rule.frontmatter.globs && rule.frontmatter.globs.length > 0) {
      const sensitiveGlobs = rule.frontmatter.globs.filter(shouldExcludeFromAI);
      if (sensitiveGlobs.length > 0) {
        patterns.push(`# Exclude: ${rule.frontmatter.description}`);
        patterns.push(...sensitiveGlobs);
      }
    }

    // Extract basic ignore patterns from rule content
    const contentPatterns = extractBasicIgnorePatternsFromContent(rule.content);
    patterns.push(...contentPatterns);
  }

  return patterns;
}

/**
 * Determine if a glob pattern should be excluded from AI analysis
 * Returns true for patterns that likely contain sensitive or non-source content
 */
function shouldExcludeFromAI(glob: string): boolean {
  const sensitivePatterns = [
    // Security-related patterns
    "**/secret**",
    "**/credential**",
    "**/token**",
    "**/key**",
    "**/password**",
    "**/auth**",
    "**/private**",
    "**/confidential**",
    "**/internal**",
    "**/internal-docs/**",
    "**/admin**",

    // Configuration patterns that might contain secrets
    "**/config/prod**",
    "**/config/production**",
    "**/config/secret**",
    "**/config/secrets/**",
    "**/env/**",
    "**/.env**",

    // Build and deployment patterns
    "**/dist/**",
    "**/build/**",
    "**/target/**",
    "**/out/**",
    "**/node_modules/**",

    // Data and media patterns
    "**/data/**",
    "**/dataset**",
    "**/backup**",
    "**/logs/**",
    "**/log/**",
    "**/temp/**",
    "**/tmp/**",
    "**/cache/**",

    // Test fixtures that might contain sensitive data
    "**/test/fixtures/**",
    "**/test**/fixture**",
    "**/test**/mock**",
    "**/test**/data/**",

    // Database and infrastructure
    "**/*.sqlite",
    "**/*.db",
    "**/*.dump",

    // Production files
    "**/*.prod.json",
    "**/*.production.*",
  ];

  const lowerGlob = glob.toLowerCase();

  return sensitivePatterns.some((pattern) => {
    // Convert glob pattern to regex for matching
    const regexPattern = pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");

    const regex = new RegExp(`^${regexPattern}$`, "i");
    return regex.test(lowerGlob);
  });
}

/**
 * Extract basic ignore patterns from rule content
 */
function extractBasicIgnorePatternsFromContent(content: string): string[] {
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
      const regex = /['"`]([^'"`]+\.(mp4|avi|zip|tar\.gz|rar|pdf|doc|xlsx))['"`]/g;
      let match;
      while ((match = regex.exec(trimmed)) !== null) {
        if (match[1]) {
          patterns.push(match[1]);
        }
      }
    }
  }

  return patterns;
}
