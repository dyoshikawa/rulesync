import re

with open("src/features/commands/opencode-command.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace("opencode\", \"command", "kilo\", \"commands")
content = content.replace(".opencode/command", ".kilo/commands")
content = content.replace(".config/opencode/command", ".config/kilo/commands")
content = content.replace("opencode-command", "kilo-command")

with open("src/features/commands/kilo-command.ts", "w") as f:
    f.write(content)

with open("src/features/commands/opencode-command.test.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace(".opencode/command", ".kilo/commands")
content = content.replace(".config/opencode/command", ".config/kilo/commands")
content = content.replace("opencode-command", "kilo-command")

with open("src/features/commands/kilo-command.test.ts", "w") as f:
    f.write(content)
