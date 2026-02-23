#!/bin/bash
# Generate release notes using OpenCode/glm-5 model
# Usage: generate-release-notes.sh <version>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <version>" >&2
    exit 1
fi

VERSION="$1"
cd "$REPO_ROOT"

git fetch --tags --quiet

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LATEST_TAG" ]; then
    COMMITS=$(git log --oneline --pretty=format:"- %s" HEAD)
else
    COMMITS=$(git log "${LATEST_TAG}..HEAD" --oneline --pretty=format:"- %s")
fi

cat << 'HEREDOC'
## What's Changed

HEREDOC

if [ -n "$COMMITS" ]; then
    echo "$COMMITS"
else
    echo "Initial release"
fi

cat << 'HEREDOC'

## Full Changelog

HEREDOC

REPO_URL="https://github.com/dyoshikawa/rulesync"

if [ -n "$LATEST_TAG" ]; then
    echo "[${LATEST_TAG}...v${VERSION}](${REPO_URL}/compare/${LATEST_TAG}...v${VERSION})"
else
    echo "[v${VERSION}](${REPO_URL}/releases/tag/v${VERSION})"
fi

if [ -n "$LATEST_TAG" ]; then
    CONTRIBUTORS=$(git log "${LATEST_TAG}..HEAD" --pretty=format:"%an" 2>/dev/null | sort -u | grep -v "github-actions\[bot\]" || true)
else
    CONTRIBUTORS=$(git log --pretty=format:"%an" 2>/dev/null | sort -u | grep -v "github-actions\[bot\]" || true)
fi

if [ -n "$CONTRIBUTORS" ]; then
    cat << 'HEREDOC'

## Contributors

HEREDOC
    while IFS= read -r contributor; do
        if [ -n "$contributor" ]; then
            echo "- @$contributor"
        fi
    done <<< "$CONTRIBUTORS"
fi
