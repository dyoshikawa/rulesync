import { z } from "zod/mini";

export const AntigravitySkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type AntigravitySkillFrontmatter = z.infer<typeof AntigravitySkillFrontmatterSchema>;
