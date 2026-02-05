import { z } from "zod/mini";

/**
 * Supported Git providers for fetch command
 */
export const ALL_GIT_PROVIDERS = ["github", "gitlab"] as const;

export const GitProviderSchema = z.enum(ALL_GIT_PROVIDERS);

export type GitProvider = z.infer<typeof GitProviderSchema>;
