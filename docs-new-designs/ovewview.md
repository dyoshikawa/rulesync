# About New Design of Rulesync

## Overview, Background and Purpose

This document describes the new design guidelines for the Rulesync project.

The Conventional codebase does not have consistent structures, and the code is not easy to understand and maintain. Especially when the external contributors want to contribute to implement supports for new AI coding tools, they may not be able to understand how to implement them.

So, we need to redesign the codebase to make it more consistent and easy to understand and maintain. Specifically, consistent interfaces and classes should be prepared to make it easier for external contributors to implement supports for new AI coding tools.

## Current status and immediate goals

My immediate goal is replacing the rules generation logics. We've already implemented the rule interfaces and classes, but rules processor interfaces and classes are not implemented yet. Please read @docs-new-designs/rules-design.md.

Others that are mcp, ignore, commands and subagents should not be replaced yet.

Attention, the replacements must not break the existing behaviors.

At key points, you should commit your changes actively.
