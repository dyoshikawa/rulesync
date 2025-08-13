---
root: false
targets: ["*"]
description: "Testing directory unification rules"
globs: ["**/*.test.ts"]
---

# テスト用ディレクトリ統一化規約

## 概要

すべてのテストコードにおいて、ディレクトリを指定して実際にファイル生成を実施する箇所では、`/tmp/tests/{randomstr}` を対象ディレクトリに指定する統一パターンを使用する。

## 必須ルール

### 1. テストディレクトリパターン

すべてのテストで以下のパターンを使用する：
- `/tmp/tests/{randomstr}` 形式の一意なランダムディレクトリ
- 既存の `src/utils/test-helpers.ts` のヘルパー関数を必須使用
- テスト間の完全な分離とクリーンアップの徹底

### 2. 推奨実装パターン

```typescript
import { setupTestDirectory } from "../utils/test-helpers.js";

describe("テスト名", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("テストケース", async () => {
    // testDir を使用してテストを実行
    const subDir = join(testDir, "subdir");
    await mkdir(subDir, { recursive: true });
    // ...
  });
});
```

### 3. 利用可能なヘルパー関数

#### `createTestDirectory(): Promise<string>`
- `/tmp/tests/rulesync-test-{random}` 形式のディレクトリを作成
- 一意なランダム文字列でディレクトリ名を生成
- 戻り値：作成されたディレクトリの絶対パス

#### `cleanupTestDirectory(testDir: string): Promise<void>`
- 指定されたテストディレクトリとその内容を完全削除
- `rm(testDir, { recursive: true, force: true })` による安全な削除

#### `setupTestDirectory(): Promise<{ testDir: string; cleanup: () => Promise<void> }>`
- テストディレクトリの作成とクリーンアップ関数をセットで提供
- beforeEach/afterEach での使用に最適化

## 禁止パターン

以下のパターンは使用を禁止する：

### ❌ __dirname ベースの固定パターン
```typescript
// 禁止：固定的なディレクトリ名
const testDir = join(__dirname, "test-temp-copilot");
const testDir = join(__dirname, "test-temp-cursor");
```

### ❌ mkdtemp の直接使用
```typescript
// 禁止：ヘルパー関数を使わない直接使用
const tempDir = await mkdtemp(join(tmpdir(), "rulesync-test-"));
```

### ❌ 固定ディレクトリ名
```typescript
// 禁止：固定的な名前
const testDir = "/tmp/test-fixed-name";
```

## 移行ガイドライン

### 既存コードの修正手順

1. **インポートの追加**
```typescript
import { setupTestDirectory } from "../utils/test-helpers.js";
```

2. **変数宣言の修正**
```typescript
// 修正前
const testDir = join(__dirname, "test-temp-tool");

// 修正後
let testDir: string;
let cleanup: () => Promise<void>;
```

3. **beforeEach/afterEach の実装**
```typescript
beforeEach(async () => {
  ({ testDir, cleanup } = await setupTestDirectory());
});

afterEach(async () => {
  await cleanup();
});
```

4. **手動削除コードの削除**
```typescript
// 削除対象：手動でのクリーンアップコード
await rm(testDir, { recursive: true, force: true });
```

### 修正が必要なファイル例

以下のようなパターンを含むファイルは修正対象：
- `join(__dirname, "test-temp-*")`
- `mkdtemp(join(tmpdir(), ...))`
- 手動での `mkdir` と `rm` の組み合わせ

## 適用範囲

### 対象テストファイル
- 実際のファイル生成を行うすべての `.test.ts` ファイル
- パーサーテスト（`src/parsers/*.test.ts`）
- ジェネレーターテスト（`src/generators/**/*.test.ts`）
- コアモジュールテスト（`src/core/*.test.ts`）
- ユーティリティテスト（一部の `src/utils/*.test.ts`）

### 除外対象
- モックのみを使用するテスト
- ファイルシステムを使用しないユニットテスト
- 既存のファイル読み取りのみのテスト

## テストの品質向上効果

### 1. 分離性の向上
- 各テストが独立したディレクトリで実行
- テスト間での干渉を完全に排除
- 並列実行時の競合状態を防止

### 2. クリーンアップの確実性
- `afterEach` での自動クリーンアップ
- テスト失敗時もディレクトリが確実に削除
- CI/CD環境でのディスク容量問題を防止

### 3. 開発効率の向上
- 統一されたパターンによる学習コストの削減
- デバッグ時の予測可能なファイル配置
- チーム全体での一貫したテスト作成方法

## トラブルシューティング

### 権限エラーの場合
```typescript
// Windows環境での権限問題対応例
beforeEach(async () => {
  ({ testDir, cleanup } = await setupTestDirectory());
});

afterEach(async () => {
  try {
    await cleanup();
  } catch (error) {
    // 権限エラーの場合は再試行
    if (process.platform === "win32") {
      await new Promise(resolve => setTimeout(resolve, 100));
      await cleanup();
    }
  }
});
```

### CI環境での考慮事項
- `/tmp` ディレクトリの存在確認
- ディスク容量の監視
- 並列実行時の競合回避

## 実装優先度

1. **高優先度**: パーサーとジェネレーターのテスト
2. **中優先度**: コアモジュールのテスト
3. **低優先度**: ユーティリティのテスト

この規約に従うことで、テストの信頼性と保守性を大幅に向上させることができる。