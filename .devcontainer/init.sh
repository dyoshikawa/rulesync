#!/bin/bash

mise install
pnpm i
npm i -g opencode-ai @byterover/cipher @openai/codex opencommit
gh auth setup-git
