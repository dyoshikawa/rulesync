import re

with open("src/features/skills/rulesync-skill.ts", "r") as f:
    content = f.read()

# Add kilo to RulesyncSkillFrontmatterSchemaInternal
schema_replacement = """  opencode: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
    }),
  ),
  kilo: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
    }),
  ),"""
content = content.replace('  opencode: z.optional(\n    z.looseObject({\n      "allowed-tools": z.optional(z.array(z.string())),\n    }),\n  ),', schema_replacement)

# Add kilo to RulesyncSkillFrontmatterInput
input_replacement = """  opencode?: {
    "allowed-tools"?: string[];
  };
  kilo?: {
    "allowed-tools"?: string[];
  };"""
content = content.replace('  opencode?: {\n    "allowed-tools"?: string[];\n  };', input_replacement)

with open("src/features/skills/rulesync-skill.ts", "w") as f:
    f.write(content)
