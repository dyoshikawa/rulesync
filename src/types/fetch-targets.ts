import { z } from "zod/mini";

import { ALL_TOOL_TARGETS } from "./tool-targets.js";

/**
 * Fetch command targets for specifying file format interpretation
 * - "rulesync": rulesync format with frontmatter containing targets, description, etc.
 * - Tool targets: interpreted as tool-specific format (e.g., claudecode, cursor)
 */
export const ALL_FETCH_TARGETS = ["rulesync", ...ALL_TOOL_TARGETS] as const;

export const FetchTargetSchema = z.enum(ALL_FETCH_TARGETS);

export type FetchTarget = z.infer<typeof FetchTargetSchema>;
