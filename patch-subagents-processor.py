import re

with open('src/features/subagents/subagents-processor.ts', 'r') as f:
    content = f.read()

opencode_import = 'import { OpenCodeSubagent } from "./opencode-subagent.js";'
kilo_import = 'import { KiloSubagent } from "./kilo-subagent.js";'

if kilo_import not in content:
    content = content.replace(opencode_import, kilo_import + "\n" + opencode_import)

opencode_block = """  [
    "opencode",
    {
      class: OpenCodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],"""

kilo_block = """  [
    "kilo",
    {
      class: KiloSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],"""

if kilo_block not in content:
    content = content.replace(opencode_block, kilo_block + "\n" + opencode_block)

with open('src/features/subagents/subagents-processor.ts', 'w') as f:
    f.write(content)
