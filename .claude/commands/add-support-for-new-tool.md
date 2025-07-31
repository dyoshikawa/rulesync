target_tool_name, tool_name_in_rulesync, remarks = $ARGUMENTS

target_tool_name: required
tool_name_in_rulesync: optional, default: target_tool_name
remarks: optional

If remarks is provided, please consider its content when performing the following tasks.

1. If currently on main branch, create and switch to a feature branch to start work.
2. Call ai-tool-spec-researcher subagent to research new tool specifications and create md files in `.rulesync/` directory.
3. Run `pnpm run generate --delete` to deploy files from `.rulesync/` to `.claude/memories`.
4. Call rulesync-tool-implementer subagent to implement rules file generation and import for the new tool.
5. Call mcp-config-generator subagent to implement MCP configuration generation for the new tool.
6. Call ignore-file-generator subagent to implement ignore file generation for the new tool.
7. Call rulesync-gitignore-updater subagent to add gitignore command support for the new tool.
8. Call code-similarity-refactorer subagent to detect code duplication and perform refactoring as needed.
9. Call ci-pipeline-fixer subagent to run CI pipeline and fix any errors.
10. Execute `git commit` and `git push`, then create a PR.
