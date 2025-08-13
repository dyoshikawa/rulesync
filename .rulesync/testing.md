---
root: false
targets: ["*"]
description: "Testing directory unification rules"
globs: ["**/*.test.ts"]
---

# Test Directory Unification Rules

## Overview

For all test code, where directories are specified for actual file generation, use the unified pattern of targeting `/tmp/tests/{random-string}` as the directory.

## Mandatory Rules

### 1. Test Directory Pattern

Use the following pattern for all tests:
- Unique random directory in `/tmp/tests/{random-string}` format
- Mandatory use of helper functions from existing `src/utils/test-helpers.ts`
- Complete separation between tests and thorough cleanup

### 2. Recommended Implementation Pattern

```typescript
import { setupTestDirectory } from "../utils/test-helpers.js";

describe("Test Name", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("Test Case", async () => {
    // Run test using testDir
    const subDir = join(testDir, "subdir");
    await mkdir(subDir, { recursive: true });
    // ...
  });
});
```

### 3. Available Helper Functions

#### `createTestDirectory(): Promise<string>`
- Creates directory in `/tmp/tests/rulesync-test-{random}` format
- Generates unique random string for directory name
- Return value: Absolute path of the created directory

#### `cleanupTestDirectory(testDir: string): Promise<void>`
- Completely removes specified test directory and its contents
- Safe deletion using `rm(testDir, { recursive: true, force: true })`

#### `setupTestDirectory(): Promise<{ testDir: string; cleanup: () => Promise<void> }>`
- Provides test directory creation and cleanup function as a set
- Optimized for use with beforeEach/afterEach

## Prohibited Patterns

The following patterns are prohibited:

### ❌ __dirname Based Fixed Patterns
```typescript
// Prohibited: Fixed directory names
const testDir = join(__dirname, "test-temp-copilot");
const testDir = join(__dirname, "test-temp-cursor");
```

### ❌ Direct Use of mkdtemp
```typescript
// Prohibited: Direct use without helper functions
const tempDir = await mkdtemp(join(tmpdir(), "rulesync-test-"));
```

### ❌ Fixed Directory Names
```typescript
// Prohibited: Fixed names
const testDir = "/tmp/test-fixed-name";
```

## Migration Guidelines

### Steps to Modify Existing Code

1. **Add Import**
```typescript
import { setupTestDirectory } from "../utils/test-helpers.js";
```

2. **Modify Variable Declaration**
```typescript
// Before modification
const testDir = join(__dirname, "test-temp-tool");

// After modification
let testDir: string;
let cleanup: () => Promise<void>;
```

3. **Implement beforeEach/afterEach**
```typescript
beforeEach(async () => {
  ({ testDir, cleanup } = await setupTestDirectory());
});

afterEach(async () => {
  await cleanup();
});
```

4. **Remove Manual Deletion Code**
```typescript
// Target for deletion: Manual cleanup code
await rm(testDir, { recursive: true, force: true });
```

### Examples of Files Requiring Modification

Files containing patterns like the following require modification:
- `join(__dirname, "test-temp-*")`
- `mkdtemp(join(tmpdir(), ...))`
- Manual combinations of `mkdir` and `rm`

## Scope of Application

### Target Test Files
- All `.test.ts` files that perform actual file generation
- Parser tests (`src/parsers/*.test.ts`)
- Generator tests (`src/generators/**/*.test.ts`)
- Core module tests (`src/core/*.test.ts`)
- Utility tests (some `src/utils/*.test.ts`)

### Exclusions
- Tests using only mocks
- Unit tests that don't use the file system
- Tests that only read existing files

## Test Quality Improvement Effects

### 1. Enhanced Isolation
- Each test runs in an independent directory
- Complete elimination of interference between tests
- Prevention of race conditions during parallel execution

### 2. Reliable Cleanup
- Automatic cleanup in `afterEach`
- Directories are reliably deleted even when tests fail
- Prevention of disk capacity issues in CI/CD environments

### 3. Improved Development Efficiency
- Reduced learning cost through unified patterns
- Predictable file placement during debugging
- Consistent test creation methods across the entire team

## Troubleshooting

### For Permission Errors
```typescript
// Example handling permission issues in Windows environment
beforeEach(async () => {
  ({ testDir, cleanup } = await setupTestDirectory());
});

afterEach(async () => {
  try {
    await cleanup();
  } catch (error) {
    // Retry in case of permission error
    if (process.platform === "win32") {
      await new Promise(resolve => setTimeout(resolve, 100));
      await cleanup();
    }
  }
});
```

### CI Environment Considerations
- Verify existence of `/tmp` directory
- Monitor disk capacity
- Avoid conflicts during parallel execution

## Implementation Priority

1. **High Priority**: Parser and generator tests
2. **Medium Priority**: Core module tests
3. **Low Priority**: Utility tests

By following these rules, test reliability and maintainability can be significantly improved.