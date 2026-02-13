---
description: "Scan for malicious code in git diff between a tag/commit and HEAD"
targets:
  - "*"
---

target_ref = $ARGUMENTS

If target_ref is not provided, ask the user which tag or commit to compare against HEAD.

## Overview

Thoroughly check for malicious code in the diff between `${target_ref}` and the latest commit (HEAD).

## Steps

1. Verify the target ref exists and get the diff scope.
   - Run `git log ${target_ref}..HEAD --oneline` to list commits.
   - Run `git diff ${target_ref}..HEAD --stat` to get file change statistics.
   - Categorize changed files into: CI/CD workflows, source code, and config/docs.

2. Execute the following security reviews in parallel using subagents:

   - Call security-reviewer subagent to review CI/CD and workflow files (`.github/`, `scripts/`) for:
     - Secret exfiltration
     - Script injection (`${{ github.event.* }}` direct expansion in `run:`)
     - Suspicious external URLs/API connections
     - Privilege escalation or token misuse
     - Malicious command execution (`curl | bash`, `eval`, base64 decode execution)
     - Supply chain attack patterns (suspicious npm packages, unsigned action references)
     - Dangerous `pull_request_target` usage

   - Call security-reviewer subagent to review source code files (`src/`) for:
     - Arbitrary code execution (`eval`, `Function` constructor, suspicious `child_process` usage)
     - Path traversal (`../..` directory escape)
     - Command injection (user input passed directly to shell commands)
     - Suspicious external communication (`fetch`, `http.request`, `axios` to external URLs)
     - Unauthorized filesystem operations
     - Credential/token leakage (hardcoded tokens, logging sensitive values)
     - Dependency tampering (suspicious `package.json` changes)
     - Backdoor patterns (obfuscated code, suspicious conditionals, hidden functionality)
     - Prototype pollution and deserialization vulnerabilities
     - Supply chain attacks (suspicious new dependency packages)

   - Call security-reviewer subagent to review config and documentation files for:
     - Suspicious dependencies or scripts in `package.json`
     - Suspicious registries or URLs in lockfiles
     - Security rule relaxation in config schemas or linter configs
     - Suspicious settings in devcontainer or editor configs
     - Phishing URLs in documentation
     - Malicious instructions in AI rule/subagent/skill definitions

3. Integrate the results from all subagents and produce a unified report in the following format:

   ```
   ## Security Review Report: ${target_ref} -> HEAD

   ### Conclusion
   - Whether malicious code was detected or not

   ### Check Results Summary Table
   | Check Item | Result |
   |------------|--------|
   | ... | ... |

   ### Findings (if any)
   | Severity | Description | File | Risk |
   |----------|-------------|------|------|
   | ... | ... | ... | ... |

   ### Recommendations (if any)
   - Actionable recommendations for each finding

   ### Positive Observations
   - Good security practices found in the diff
   ```
