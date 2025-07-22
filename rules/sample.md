---
root: true
targets: ["augmentcode"]
description: "AugmentCode sample rule"
globs: ["**/*.ts", "**/*.js"]
---

# Sample AugmentCode Rule

This is a sample rule for testing AugmentCode ignore file generation.

# AUGMENT_IGNORE: test-data/**
# augmentignore: *.temp
# AUGMENT_INCLUDE: important-docs/**
# augmentinclude: config/example.*

This rule mentions some large files like 'backup.zip' and 'video.mp4' that should be ignored.