## Simulate Commands, Subagents and Skills

Simulated commands, subagents and skills allow you to generate simulated features for cursor, codexcli and etc. This is useful for shortening your prompts.

1. Prepare `.rulesync/commands/*.md`, `.rulesync/subagents/*.md` and `.rulesync/skills/*/SKILL.md` for your purposes.
2. Generate simulated commands, subagents and skills for specific tools that are included in cursor, codexcli and etc.
   ```bash
   npx rulesync generate \
     --targets copilot,cursor,codexcli \
     --features commands,subagents,skills \
     --simulate-commands \
     --simulate-subagents \
     --simulate-skills
   ```
3. Use simulated commands, subagents and skills in your prompts.
   - Prompt examples:

     ```txt
     # Execute simulated commands. By the way, `s/` stands for `simulate/`.
     s/your-command

     # Execute simulated subagents
     Call your-subagent to achieve something.

     # Use simulated skills
     Use the skill your-skill to achieve something.
     ```
