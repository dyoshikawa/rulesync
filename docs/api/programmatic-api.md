# Programmatic API

Rulesync can be used as a library in your Node.js/TypeScript projects. The `generate`, `importFromTool`, and `convertFromTool` functions are available as named exports.

```typescript
import { convertFromTool, generate, importFromTool } from "rulesync";

// Generate configurations
const result = await generate({
  targets: ["claudecode", "cursor"],
  features: ["rules", "mcp"],
});
console.log(`Generated ${result.rulesCount} rules, ${result.mcpCount} MCP configs`);

// Import existing tool configurations into .rulesync/
const importResult = await importFromTool({
  target: "claudecode",
  features: ["rules", "commands"],
});
console.log(`Imported ${importResult.rulesCount} rules`);

// Convert configurations between AI tools without writing intermediate .rulesync/ files
try {
  const convertResult = await convertFromTool({
    from: "claudecode",
    to: ["cursor", "copilot"],
    features: ["rules"],
  });
  console.log(`Converted ${convertResult.rulesCount} rule file(s)`);
} catch (error) {
  // Thrown when `from` is empty, `to` is empty, `to` includes `from`,
  // a source file cannot be parsed, or write fails.
  console.error("convert failed:", error);
}
```

## `generate(options?)`

Generates configuration files for the specified targets and features.

| Option              | Type           | Default           | Description                                  |
| ------------------- | -------------- | ----------------- | -------------------------------------------- |
| `targets`           | `ToolTarget[]` | from config file  | Tools to generate configurations for         |
| `features`          | `Feature[]`    | from config file  | Features to generate                         |
| `baseDirs`          | `string[]`     | `[process.cwd()]` | Base directories for generation              |
| `configPath`        | `string`       | auto-detected     | Path to `rulesync.jsonc`                     |
| `verbose`           | `boolean`      | `false`           | Enable verbose logging                       |
| `silent`            | `boolean`      | `true`            | Suppress all output                          |
| `delete`            | `boolean`      | from config file  | Delete existing files before generating      |
| `global`            | `boolean`      | `false`           | Generate global (user scope) configurations  |
| `simulateCommands`  | `boolean`      | `false`           | Generate simulated commands                  |
| `simulateSubagents` | `boolean`      | `false`           | Generate simulated subagents                 |
| `simulateSkills`    | `boolean`      | `false`           | Generate simulated skills                    |
| `dryRun`            | `boolean`      | `false`           | Show changes without writing files           |
| `check`             | `boolean`      | `false`           | Exit with code 1 if files are not up to date |

## `importFromTool(options)`

Imports existing tool configurations into `.rulesync/` directory.

| Option       | Type         | Default          | Description                               |
| ------------ | ------------ | ---------------- | ----------------------------------------- |
| `target`     | `ToolTarget` | (required)       | Tool to import configurations from        |
| `features`   | `Feature[]`  | from config file | Features to import                        |
| `configPath` | `string`     | auto-detected    | Path to `rulesync.jsonc`                  |
| `verbose`    | `boolean`    | `false`          | Enable verbose logging                    |
| `silent`     | `boolean`    | `true`           | Suppress all output                       |
| `global`     | `boolean`    | `false`          | Import global (user scope) configurations |

## `convertFromTool(options)`

Converts configuration files between AI tools without writing intermediate `.rulesync/` files to disk.

| Option       | Type           | Default       | Description                                                                                 |
| ------------ | -------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `from`       | `ToolTarget`   | (required)    | Source tool to convert configurations from                                                  |
| `to`         | `ToolTarget[]` | (required)    | Destination tools to convert to                                                             |
| `features`   | `Feature[]`    | `["*"]`       | Features to convert. Matches CLI behavior and overrides any `features` in `rulesync.jsonc`. |
| `configPath` | `string`       | auto-detected | Path to `rulesync.jsonc`                                                                    |
| `verbose`    | `boolean`      | `false`       | Enable verbose logging                                                                      |
| `silent`     | `boolean`      | `true`        | Suppress all output                                                                         |
| `global`     | `boolean`      | `false`       | Convert global (user scope) configurations                                                  |
| `dryRun`     | `boolean`      | `false`       | Show changes without writing files                                                          |
