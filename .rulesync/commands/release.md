---
targets:
  - "*"
description: Release a new version of the project.
---

First, let's work on the following steps.

1. Confirm that you are currently on the main branch. If not on main branch, abort this operation.
2. Compare code changes between the previous version tag and the latest commit to prepare the release description.

- Write in English.
- Do not include confidential information.
- Sections, `What's Changed`, `Contributors` and `Full Changelog` are needed.
- `./ai-tmp/release-notes.md` will be used as the release notes.

Then, from $ARGUMENTS, get the new version without v prefix, and assign it to $new_version. For example, if $ARGUMENTS is "v1.0.0", the new version is "1.0.0".

Unless the user does not explicitly specify the new version, please judge the new version from the release description with the following the general semantic versioning rules.

Let's resume the release process.

3. Run `git pull`.
4. Run `git checkout -b release/v${new_version}`.
5. Update `getVersion()` function to return the ${new_version} in `src/cli/index.ts`, and run `pnpm cicheck:code`. If the checks fail, fix the code until pass. Then, execute `git add` and `git commit`.
6. Update the version with `pnpm version ${new_version} --no-git-tag-version`.
7. Since `package.json` will be modified, execute `git commit` and `git push`.
8. Run `gh pr create` and `gh pr merge --admin` to merge the release branch into the main branch.
9. As a precaution, verify that `getVersion()` in `src/cli/index.ts` is updated to the ${new_version}.
10. Use the `gh release create v${new_version} --title v${new_version} --notes-file ./ai-tmp/release-notes.md ...` command to create a Release on the `github.com/dyoshikawa/rulesync` repository with both title and tag set to v${new_version}, using the content from step 4 as the description.
11. Clean up the brances. Run `git checkout main`, `git branch -D release/v${new_version}` and `git pull --prune`.
