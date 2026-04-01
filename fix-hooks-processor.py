with open('src/features/hooks/hooks-processor.ts', 'r') as f:
    content = f.read()

bad_string = "      supportedEvents: KILO_HOOK_EVENTS,\n  OPENCODE_HOOK_EVENTS,"
good_string = "      supportedEvents: OPENCODE_HOOK_EVENTS,"

content = content.replace(bad_string, good_string)

with open('src/features/hooks/hooks-processor.ts', 'w') as f:
    f.write(content)
