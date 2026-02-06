## Dry Run

Rulesync provides two dry run options for the `generate` command that allow you to see what changes would be made without actually writing files:

### `--dry-run`

Show what would be written or deleted without actually writing any files. Changes are displayed with a `[DRY RUN]` prefix.

```bash
npx rulesync generate --dry-run --targets claudecode --features rules
```

### `--check`

Same as `--dry-run`, but exits with code 1 if files are not up to date. This is useful for CI/CD pipelines to verify that generated files are committed.

```bash
# In your CI pipeline
npx rulesync generate --check --targets "*" --features "*"
echo $?  # 0 if up to date, 1 if changes needed
```

> [!NOTE]
> `--dry-run` and `--check` cannot be used together.
