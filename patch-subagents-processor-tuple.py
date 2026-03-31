import re

with open('src/features/subagents/subagents-processor.ts', 'r') as f:
    content = f.read()

tuple_str = 'const subagentsProcessorToolTargetTuple = ['
tuple_kilo = 'const subagentsProcessorToolTargetTuple = [\n  "kilo",'
if '"kilo"' not in content.split(tuple_str)[1].split(']')[0]:
    content = content.replace(tuple_str, tuple_kilo)

with open('src/features/subagents/subagents-processor.ts', 'w') as f:
    f.write(content)
