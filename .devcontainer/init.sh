#!/bin/bash

mise install
pnpm i
npm i -g opencode-ai @byterover/cipher @openai/codex opencommit @google/gemini-cli
gh auth setup-git
