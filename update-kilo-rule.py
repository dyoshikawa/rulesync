import re

with open("src/features/rules/opencode-rule.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace(".config/kilo", ".config/kilo")
content = content.replace(".kilo\", \"memories\"", ".kilo\", \"rules\"")
content = content.replace("opencode-rule", "kilo-rule")

with open("src/features/rules/kilo-rule.ts", "w") as f:
    f.write(content)

with open("src/features/rules/opencode-rule.test.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace(".config/kilo", ".config/kilo")
content = content.replace(".kilo/memories", ".kilo/rules")
content = content.replace("opencode-rule", "kilo-rule")

with open("src/features/rules/kilo-rule.test.ts", "w") as f:
    f.write(content)
