#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SKILL_DIR="$PROJECT_ROOT/skills/rulesync"
SKILL_FILE="$SKILL_DIR/SKILL.md"

mkdir -p "$SKILL_DIR"

{
  printf '%s\n' '---'
  printf '%s\n' 'name: rulesync'
  printf '%s\n' 'description: >-'
  printf '%s\n' '  Rulesync CLI tool documentation - unified AI rule file management'
  printf '%s\n' '  for various AI coding tools'
  printf '%s\n' 'targets: ["*"]'
  printf '%s\n' '---'
  printf '\n'
  cat "$PROJECT_ROOT/README.md"
} > "$SKILL_FILE"

echo "Synced README.md to $SKILL_FILE"
