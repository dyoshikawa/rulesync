## Official Skills

Rulesync provides official skills that you can install using the fetch command or declarative sources:

```bash
# One-time fetch
npx rulesync fetch dyoshikawa/rulesync --features skills

# Or declare in rulesync.jsonc for automatic fetching on every generate
{
  "sources": [
    { "source": "dyoshikawa/rulesync" }
  ]
}
```

This will install the Rulesync documentation skill to your project.
