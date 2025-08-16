#!/bin/bash

mise install
pnpm i
npm i -g @anthropic-ai/claude-code
npm i -g opencode-ai
gh auth setup-git
