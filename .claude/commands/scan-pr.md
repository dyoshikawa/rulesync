PR_URL = $ARGUMENTS

PR_NUMBER = getPRNumberFromURL(PR_URL)

Review all files in the diff in the PR for the following points:

- No vulnerable code is included
- No malicious code is included

Use `gh pr view {PR_NUMBER} --repo dyoshikawa/rulesync` and `gh pr {PR_NUMBER} view --repo dyoshikawa/rulesync` to get the PR number.

Make `{PROJECT_ROOT}/tmp/scan-pr-{PR_NUMBER}.md`, then write the results to the file sequentially.

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
