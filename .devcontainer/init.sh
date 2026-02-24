#!/bin/bash

# Ensure node_modules and pnpm-store volumes have correct ownership for non-root user
sudo chown -R node:node /workspace/node_modules 2>/dev/null || true
sudo chown -R node:node /home/node/.pnpm-store 2>/dev/null || true

# Configure pnpm store directory for devcontainer
pnpm config set store-dir /home/node/.pnpm-store

# Install project dependencies
pnpm i

gh auth setup-git
