#!/bin/bash

gh auth setup-git
mise install
pnpm i
npm i -g @anthropic-ai/claude-code
