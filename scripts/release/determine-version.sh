#!/bin/bash
# Determine the next version based on semantic versioning rules
# Analyzes commits since the last release and suggests version bump

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$REPO_ROOT"

git fetch --tags --quiet

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LATEST_TAG" ]; then
    echo "0.1.0"
    exit 0
fi

CURRENT_VERSION="${LATEST_TAG#v}"

COMMITS=$(git log "${LATEST_TAG}..HEAD" --oneline 2>/dev/null || echo "")

if [ -z "$COMMITS" ]; then
    echo "No changes since last release" >&2
    exit 1
fi

MAJOR=0
MINOR=0
PATCH=0

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

HAS_BREAKING=false
HAS_FEATURE=false
HAS_FIX=false

while IFS= read -r commit; do
    commit_lower=$(echo "$commit" | tr '[:upper:]' '[:lower:]')
    
    if echo "$commit_lower" | grep -qE '(breaking|breaking change|!:|breaks)'; then
        HAS_BREAKING=true
    elif echo "$commit_lower" | grep -qE '^(feat|feature)'; then
        HAS_FEATURE=true
    elif echo "$commit_lower" | grep -qE '^fix'; then
        HAS_FIX=true
    fi
done <<< "$COMMITS"

if [ "$HAS_BREAKING" = true ]; then
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
elif [ "$HAS_FEATURE" = true ]; then
    MINOR=$((MINOR + 1))
    PATCH=0
else
    PATCH=$((PATCH + 1))
fi

echo "${MAJOR}.${MINOR}.${PATCH}"
