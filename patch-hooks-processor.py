import re

with open('src/features/hooks/hooks-processor.ts', 'r') as f:
    content = f.read()

# Fix the Kilo block we added earlier
wrong_kilo_block = """  [
    "kilo",
    {
      class: KiloHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: false,
      },
    },
  ],"""

right_kilo_block = """  [
    "kilo",
    {
      class: KiloHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: false,
      },
      supportedEvents: KILO_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],"""

if wrong_kilo_block in content:
    content = content.replace(wrong_kilo_block, right_kilo_block)

# Add "kilo" to hooksProcessorToolTargetTuple
tuple_str = 'const hooksProcessorToolTargetTuple = ['
tuple_kilo = 'const hooksProcessorToolTargetTuple = [\n  "kilo",'
if '"kilo"' not in content.split(tuple_str)[1].split(']')[0]:
    content = content.replace(tuple_str, tuple_kilo)

# Add import KILO_HOOK_EVENTS
import_opencode_events = "OPENCODE_HOOK_EVENTS,"
import_kilo_events = "KILO_HOOK_EVENTS,\n  OPENCODE_HOOK_EVENTS,"
if "KILO_HOOK_EVENTS" not in content:
    content = content.replace(import_opencode_events, import_kilo_events)

with open('src/features/hooks/hooks-processor.ts', 'w') as f:
    f.write(content)
