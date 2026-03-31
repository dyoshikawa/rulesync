import re

with open("src/features/mcp/opencode-mcp.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace("Opencode", "Kilo")
content = content.replace("opencode.json", "kilo.json")
content = content.replace("opencode.jsonc", "kilo.jsonc")
content = content.replace(".config/opencode", ".config/kilo")
content = content.replace("opencode-mcp", "kilo-mcp")

with open("src/features/mcp/kilo-mcp.ts", "w") as f:
    f.write(content)

with open("src/features/mcp/opencode-mcp.test.ts", "r") as f:
    content = f.read()

content = content.replace("OpenCode", "Kilo")
content = content.replace("opencode", "kilo")
content = content.replace("Opencode", "Kilo")
content = content.replace("opencode.json", "kilo.json")
content = content.replace("opencode.jsonc", "kilo.jsonc")
content = content.replace(".config/opencode", ".config/kilo")
content = content.replace("opencode-mcp", "kilo-mcp")

with open("src/features/mcp/kilo-mcp.test.ts", "w") as f:
    f.write(content)
