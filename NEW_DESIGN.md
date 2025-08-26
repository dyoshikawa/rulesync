# About New Design of Rulesync

## Overview, Background and Purpose

This document describes the new design guidelines for the Rulesync project.

The Conventional codebase does not have consistent structures, and the code is not easy to understand and maintain. Especially when the external contributors want to contribute to implement supports for new AI coding tools, they may not be able to understand how to implement them.

So, we need to redesign the codebase to make it more consistent and easy to understand and maintain. Specifically, consistent interfaces and classes should be prepared to make it easier for external contributors to implement supports for new AI coding tools.

## Replacement Strategy

- Existing dirs: src/cli, src/constants, src/core, src/generators, src/parsers, src/test-utils, src/types, src/utils
- New dirs: src/subagents, src/rules, src/mcp, src/commands, src/ignore

The replacement is conducted while coexisting with the existing codebase. 

I think, finally, src/cli will depend on src/subagents, src/rules, src/mcp, src/commands and src/ignore. Then, src/core, src/generators and src/parsers will be abolished. Others that are src/constants, src/test-utils, src/types and src/utils will be used in the future too.

## Current status and immediate goals

My immediate goal is replacing the subagents logics.

Others that are mcp, ignore, commands and rules should not be replaced yet.

Attention, the replacements must not break the existing behaviors.

At key points, you should commit your changes actively.

## 
