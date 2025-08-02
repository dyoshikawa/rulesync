FILE_PATTERN = $ARGUMENTS || './**/*'

Review all files matching $FILE_PATTERN for the following points:

- No vulnerable code is included
- No malicious code is included

For example, `node_modules/**/*` and other non-git-managed files are excluded from the scan.

Make `{PROJECT_ROOT}/tmp/scan.md`, then write the results to the file sequentially.

Follow the format below:

```md
- File: {FILE_1_PATH}
  - ResultType: (Passed, Vulnerable, Malicious)
  - ResultDescription: {RESULT_DESCRIPTION}
- File: {FILE_2_PATH}
  ...

# Summary

- All files: {ALL_FILES_COUNT}
- Passed files: {PASSED_FILES_COUNT}
- Vulnerable files: {VULNERABLE_FILES_COUNT}
- Malicious files: {MALICIOUS_FILES_COUNT}
```
