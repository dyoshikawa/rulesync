---
description: "Release a new version of the project."
targets:
  - "*"
---

## GitHub Actions Release Flow (Recommended)

The recommended way to release is via GitHub Actions:

1. Go to Actions > Bump Version workflow in GitHub
2. Click "Run workflow" and optionally specify a version (leave empty for automatic detection)
3. Review the generated PR with version bump changes
4. Merge the PR to trigger the release process
5. The workflow will:
   - Create a draft release with generated release notes
   - Build and upload release assets (binaries, checksums, TOON files)
   - Publish the release
   - Clean up the release branch

## Manual Release Process

If you need to release manually, follow these steps:

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
10. Create a **draft** release using `gh release create v${new_version} --draft --title v${new_version} --notes-file ./ai-tmp/release-notes.md` command on the `github.com/dyoshikawa/rulesync` repository. This creates a draft release so that the publish-assets workflow can upload assets.
11. Wait for the publish-assets workflow to complete successfully. Use `gh run list --workflow="Publish Assets" --branch v${new_version} --limit 1 --json status,conclusion,databaseId` to check the status. Poll until the workflow completes (status is "completed"). If it fails, abort the release process and report the failure.
12. Once the publish-assets workflow succeeds, publish the release by running `gh release edit v${new_version} --draft=false`.
13. Clean up the branches. Run `git checkout main`, `git branch -D release/v${new_version}` and `git pull --prune`.
