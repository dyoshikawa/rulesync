#!/bin/bash

# Ensure node_modules and pnpm-store volumes have correct ownership for non-root user
sudo chown -R node:node /workspace/node_modules 2>/dev/null || true
sudo chown -R node:node /workspace/.pnpm-store 2>/dev/null || true

gh auth setup-git
