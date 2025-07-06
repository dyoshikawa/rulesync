export default {
  "*.{ts,js}": [
    "biome check --write",
    "oxlint --fix --max-warnings 0",
    "eslint --fix --max-warnings 0 --cache --no-warn-ignored",
  ],
  "*.ts": [() => "tsgo --noEmit", () => "pnpm test"],
  "**/*": ["secretlint", "cspell"],
};
