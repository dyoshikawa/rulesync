---
name: draft-release
description: "Draft a new release of the project."
targets:
  - "*"
---

First, let's work on the following steps.

1. Confirm that you are currently on the main branch and pull the latest changes. If not on main branch, switch to main branch.
2. Compare code changes between the previous version tag and the latest commit to prepare the release description.

- Write in English.
- Do not include confidential information.
- Sections, `What's Changed`, `Contributors` and `Full Changelog` are needed.
- `./tmp/release-notes/*.md` will be used as the release notes.

Then, from $ARGUMENTS, get the new version without v prefix, and assign it to $new_version. For example, if $ARGUMENTS is "v1.0.0", the new version is "1.0.0".

If $ARGUMENTS is empty, determine the new version automatically by performing the `release-dry-run` skill.

Let's resume the release process.

3. Run `git pull`.
4. Run `git checkout -b release/v${new_version}`.
5. Update `getVersion()` function to return the ${new_version} in `src/cli/index.ts`, and run `pnpm cicheck`. If the checks fail, fix the code until pass. Then, execute `git add`, `git commit` and `git push`.
6. Update the version with `pnpm version ${new_version} --no-git-tag-version`.
7. Since `package.json` will be modified, execute `git commit` and `git push`.
8. As a precaution, verify that `getVersion()` in `src/cli/index.ts` is updated to the ${new_version}.
9. Run `gh pr create` to the main branch.
10. Create a **draft** release using `gh release create v${new_version} --draft --title v${new_version} --notes-file ./tmp/release-notes/*.md` command on the `github.com/dyoshikawa/rulesync` repository. This creates a draft release so that the publish-assets workflow can upload assets later.
