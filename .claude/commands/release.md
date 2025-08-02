new_version = get_version_without_v_prefix($ARGUMENTS) # example: 1.0.0
new_version_with_v_prefix = get_version_with_v_prefix($ARGUMENTS) # example: v1.0.0

1. Confirm that you are currently on the main branch. If not on main branch, abort this operation.
2. Run `git pull`.
3. Run `git checkout -b release/{new_version_with_v_prefix}`.
4. Update the version in `src/cli/index.ts`. Then, execute `git add` and `git commit`.
5. Update the version with `pnpm version {new_version} --no-git-tag-version`.
6. Since `package.json` will be modified, execute `git commit` and `git push`.
7. Run `gh pr create` and `gh pr merge --admin` to merge the release branch into the main branch.
8. Compare code changes between the previous version tag and current commit to prepare the Release description.
  - Write in English.
  - Do not include confidential information.
  - Sections, `What's Changed`, `Contributors` and `Full Changelog` are needed.
  - `./ai-tmp/release-notes.md` will be used as the release notes.
9. As a precaution, verify that the release content does not contain any information that should remain private.
10. Use the `gh release create {new_version_with_v_prefix} --title {new_version_with_v_prefix} --notes-file ./ai-tmp/release-notes.md ...` command to create a Release on the `github.com/dyoshikawa/rulesync` repository with both title and tag set to new_version_with_v_prefix, using the content from step 4 as the description.
