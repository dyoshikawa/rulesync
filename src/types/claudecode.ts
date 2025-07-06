import { z } from "zod/v4-mini";

export const ClaudeSettingsSchema = z.looseObject({
  permissions: z._default(
    z.looseObject({
      deny: z._default(z.array(z.string()), []),
    }),
    { deny: [] },
  ),
});

export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;
