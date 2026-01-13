---
targets:
  - "*"
description: >-
  Dry run for release: summarize changes since last release and suggest version
  bump.
---

This is a dry run command for release. It will summarize the changes since the last release and suggest the appropriate version bump based on semantic versioning.

## Steps

1. Get the latest release tag.
   - Run `git fetch --tags` to ensure all tags are available.
   - Run `git describe --tags --abbrev=0` to get the latest tag.
   - Assign the result to $latest_tag.

2. Compare code changes between the latest tag and the current HEAD.
   - Run `git log ${latest_tag}..HEAD --oneline` to get the commit list.
   - Run `git diff ${latest_tag}..HEAD --stat` to get the file change statistics.

3. Analyze the changes and create a summary in the following format:

   ```
   ## Changes Summary

   ### Commits since ${latest_tag}
   - List of commits with their messages

   ### Changed Files
   - Summary of file changes (added, modified, deleted)

   ### Change Categories
   - **Breaking Changes**: List any breaking changes (API changes, removed features, etc.)
   - **New Features**: List new features added
   - **Bug Fixes**: List bug fixes
   - **Other Changes**: List other changes (refactoring, documentation, tests, etc.)
   ```

4. Based on the analysis, suggest the appropriate version bump following semantic versioning rules:
   - **MAJOR** (X.0.0): Breaking changes that are not backward compatible
     - Removed or renamed public APIs
     - Changed behavior of existing features
     - Dropped support for older Node.js versions
   - **MINOR** (x.Y.0): New features that are backward compatible
     - New CLI commands or options
     - New configuration options
     - New tool support
   - **PATCH** (x.y.Z): Bug fixes and minor improvements
     - Bug fixes
     - Documentation updates
     - Internal refactoring without API changes
     - Dependency updates (unless they cause breaking changes)

5. Output the final recommendation in the following format:

   ```
   ## Version Bump Recommendation

   Current version: ${latest_tag}
   Recommended bump: MAJOR / MINOR / PATCH
   Suggested new version: vX.Y.Z

   ### Reasoning
   - Explain why this version bump is recommended based on the changes.
   ```

**Note**: This is a dry run only. No files will be modified and no commits will be made.
