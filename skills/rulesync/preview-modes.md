## Preview Modes

Rulesync provides two preview modes for the `generate` command that allow you to see what changes would be made without actually writing files:

### `--dry-run`

Preview changes without writing any files. Shows what would be written or deleted with a `[PREVIEW]` prefix.

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
