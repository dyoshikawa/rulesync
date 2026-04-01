import re

with open("src/features/skills/opencode-skill.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace("opencode\", \"skill", "kilo\", \"skills")
content = content.replace(".opencode/skill", ".kilo/skills")
content = content.replace(".config/opencode/skill", ".config/kilo/skills")
content = content.replace("opencode-skill", "kilo-skill")

with open("src/features/skills/kilo-skill.ts", "w") as f:
    f.write(content)

with open("src/features/skills/opencode-skill.test.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace(".opencode/skill", ".kilo/skills")
content = content.replace(".config/opencode/skill", ".config/kilo/skills")
content = content.replace("opencode-skill", "kilo-skill")

with open("src/features/skills/kilo-skill.test.ts", "w") as f:
    f.write(content)
