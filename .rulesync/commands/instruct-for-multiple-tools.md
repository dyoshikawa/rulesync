---
description: 'Instruct for multiple AI coding tools.'
targets:
  - claudecode
---

$ARGUMENTS is required.

The user want to instruct implementation or fix about multiple AI coding tools at once. So you need to follow the following steps.

1. Check on @src/types/tool-targets.ts, and then put all tool names to $all_tools.
2. If included tools are provided in $ARGUMENTS, you put the included tool names to $included_tools.
3. If excluded tools are provided in $ARGUMENTS, you put the excluded tool names to $excluded_tools.
4. Extract the instruction about change specification, implementation or fix from $ARGUMENTS, and then put it to $instruction.
4. if ($included_tools.length > 0) { $processed_tools = $included_tools } else { $processed_tools = $all_tools - $excluded_tools }
5. Put your todo list to [for $instruction about $tool in $processed_tools] that is a expression like a Python's list comprehension.
6. Work on your todo list.
