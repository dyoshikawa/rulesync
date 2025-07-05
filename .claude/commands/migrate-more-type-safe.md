target_dir = $ARGUMENTS

I want to eliminate all `as` assertions except for `as const`. `as` assertions should be avoided as they compromise type safety. If you absolutely must use `as` assertions to pass type checking, you should validate with zod schemas since the value types cannot be guaranteed.

Please execute the following tasks:

1. `target_dir/**/*.ts` ファイルを対象に、 `pnpm exec eslint` を実行し `as` アサーションを使用している箇所を検出します。
2. `as` アサーションを使用している箇所を修正します。
    - `as const` や `satisfies` を使用して解決できる場合は、そちらに置き換えます。
    - そもそも値の形式をバリデーションすべき場合は、zodスキーマを使用してバリデーションを追加します。zodスキーマが `src/types/*.ts` に存在する場合はそれをimportして使用します。存在しない場合は新たに `src/type/*.ts` にzodスキーマと `z.infer()` で導出した型定義を作成します。
3. 修正後、各種チェックが通ることを確認します。
     - `pnpm fix`
     - `pnpm test`
4. If there are no issues, commit the changes.
