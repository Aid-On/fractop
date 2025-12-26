# @aid-on/fractop

[![npm version](https://badge.fury.io/js/@aid-on%2Ffractop.svg)](https://www.npmjs.com/package/@aid-on/fractop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)

日本語 | [English](./README.md)

FractoP (Fractal Processor) - LLMを使用したフラクタルアーキテクチャによる無限長テキスト処理ライブラリ。

## 特徴

- **無限長対応**: インテリジェントなチャンク分割により任意サイズの文書を処理
- **コンテキスト伝播**: 処理全体を通じてグローバルコンテキストとチャンク間サマリーを維持
- **スマートチャンキング**: 段落/文境界で分割、設定可能なオーバーラップ（より安全な6000文字デフォルト）
- **並列処理**: パフォーマンス向上のためのオプション並列チャンク処理（コンテキスト伝播なし）
- **ストリーミングAPI**: Nagare Stream<T>統合によるメモリ効率的な処理
- **自動重複排除**: 抽出アイテムの自動重複排除
- **補足処理**: 結果が不足時に自動で追加抽出
- **エンタープライズグレードの信頼性**: タイムアウト、指数バックオフ付きリトライ、サーキットブレーカーパターン内蔵

## インストール

```bash
npm install @aid-on/fractop
```

## クイックスタート

```typescript
import { FractalProcessor, simpleMerge, type LLMProvider } from '@aid-on/fractop';
import type { Stream } from '@aid-on/nagare';

// LLMProviderインターフェースを実装
const llm: LLMProvider = {
  async chat(systemPrompt, userPrompt, options) {
    // あなたのLLM実装をここに
    return await yourLLM.complete({ systemPrompt, userPrompt, ...options });
  }
};

// プロセッサを作成
const processor = new FractalProcessor<{ keyword: string; weight: number }>(llm, {
  chunkSize: 6000,       // チャンクあたりの文字数（トークン制限に対してより安全なデフォルト）
  overlapSize: 500,      // チャンク間のオーバーラップ
  minResultCount: 30,    // 最小結果数の閾値
  parallelProcessing: false,  // 並列処理を有効にする
  concurrency: 3,        // 並列モードでの最大同時チャンク数
});

// 長文テキストを処理
const keywords = await processor.process(longText, {
  generateContext: async (text) => {
    // ドキュメントサマリーを生成
    return await llm.chat(
      'Summarizer',
      `この文書を3文で要約してください:\n\n${text.substring(0, 8000)}`,
      { temperature: 0.3 }
    );
  },

  processChunk: async (chunk, context) => {
    // このチャンクからキーワードを抽出
    const response = await llm.chat(
      'Keyword Extractor',
      `コンテキスト: ${context.globalContext}\n\n` +
      `以下からキーワードを抽出:\n${chunk}`,
      { temperature: 0.2 }
    );
    return { items: parseKeywords(response) };
  },

  mergeResults: (results) => simpleMerge(results, 30),
  getKey: (item) => item.keyword,
});
```

## アーキテクチャ

FractoPは、LLMのコンテキスト制限を超えるドキュメントを処理するためにフラクタルアーキテクチャを使用します：

1. **グローバルコンテキスト生成**: ドキュメント全体のサマリーを作成
2. **インテリジェントチャンキング**: 自然な境界でオーバーラップ付きで分割
3. **逐次処理**: コンテキスト伝播を使用して各チャンクを処理
4. **結果のマージ**: すべてのチャンクからの結果を結合・重複排除
5. **補足処理**: 最小閾値以下の場合に追加結果を追加

### 処理フロー

```
入力テキスト
    ↓
グローバルコンテキスト生成
    ↓
チャンクに分割（オーバーラップあり）
    ↓
各チャンクを処理（コンテキスト付き）
    ↓
結果をマージ＆重複排除
    ↓
必要に応じて補足
    ↓
最終結果
```

## 設定

### FractalConfigオプション

```typescript
interface FractalConfig {
  chunkSize?: number;        // デフォルト: 6000（トークン制限に対してより安全）
  overlapSize?: number;      // デフォルト: 500
  minResultCount?: number;   // デフォルト: 30
  supplementCount?: number;  // デフォルト: 50
  parallelProcessing?: boolean;  // デフォルト: false
  concurrency?: number;      // デフォルト: 3
  enableStreaming?: boolean; // デフォルト: false
  timeout?: number;          // 全体のタイムアウト（ミリ秒）
  chunkTimeout?: number;     // チャンクごとのタイムアウト（ミリ秒）
  maxRetries?: number;       // デフォルト: 3
  retryDelay?: number;       // 初期リトライ遅延（ミリ秒）
  circuitBreakerThreshold?: number;  // デフォルト: 3
}
```

### マージ関数

#### simpleMerge<T>(results, minCount)

すべての結果をフラット化し、minCount未満の場合は補足フラグを立てます。

```typescript
const merged = simpleMerge(results, 30);
```

#### weightedMerge<T>(results, getKey, minCount)

複数のチャンクに出現するアイテムの重みを集計します。

```typescript
const merged = weightedMerge(
  results,
  (item) => item.keyword,
  30
);
```

## 高度な機能

### 並列処理

より良いパフォーマンスのためにチャンクを並列処理（注：このモードではコンテキスト伝播は無効）：

```typescript
const processor = new FractalProcessor(llm, {
  parallelProcessing: true,
  concurrency: 5,  // 最大5チャンクを同時に処理
});

// コンテキスト伝播を必要としないタスクに使用
const keywords = await processor.process(text, options);
```

### NagareによるストリーミングAPI

大規模ドキュメントのメモリ効率的な処理のためにストリーム結果：

```typescript
// 非同期イテレータを使用
for await (const item of processor.processStream(text, options)) {
  console.log('受信したアイテム:', item);
  // 到着したアイテムを処理
}

// Nagare Stream<T>を使用
const stream: Stream<T> = processor.processAsStream(text, options);
stream
  .filter(item => item.weight > 0.5)
  .map(item => item.keyword)
  .subscribe({
    next: keyword => console.log('高重みキーワード:', keyword),
    complete: () => console.log('ストリーム完了')
  });
```

## 信頼性機能

### タイムアウト制御

```typescript
const processor = new FractalProcessor(llm, {
  timeout: 300000,        // 全体で5分
  chunkTimeout: 60000,    // チャンクあたり1分
});
```

### 指数バックオフ付き自動リトライ

```typescript
const processor = new FractalProcessor(llm, {
  maxRetries: 3,          // 最大3回リトライ
  retryDelay: 1000,       // 1秒から開始、次は2秒、4秒...
});
```

### サーキットブレーカーパターン

```typescript
const processor = new FractalProcessor(llm, {
  circuitBreakerThreshold: 3,  // 3回連続失敗後にブレーク
});

const result = await processor.processWithMetadata(text, options);
if (result.circuitBreakerTripped) {
  console.error('繰り返しエラーのため処理を停止');
}
```

### 可観測性のためのイベントシステム

```typescript
processor.on((event) => {
  switch (event.type) {
    case 'chunk_start':
      console.log(`チャンク ${event.index + 1}/${event.total} を処理中`);
      break;
    case 'chunk_complete':
      console.log(`チャンク ${event.index + 1} 完了`);
      break;
    case 'chunk_retry':
      console.warn(`チャンク ${event.index} をリトライ中（試行 ${event.attempt}）`);
      break;
    case 'complete':
      console.log(`処理完了: ${event.totalItems} 件の結果`);
      break;
  }
});
```

## LLMProviderインターフェース

```typescript
interface LLMProvider {
  chat(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string>;
}
```

以下と互換性あり：
- OpenAI GPT
- Anthropic Claude
- Google Gemini
- Cloudflare Workers AI
- チャット補完APIを持つ任意のLLM

## ユースケース

- **用語抽出**: ドキュメントから技術用語を抽出して定義
- **キーワード分析**: 検索/タグ付けのための重み付きキーワード抽出
- **ドキュメント構造化**: ピラー/トピックを抽出してセクションを割り当て
- **翻訳**: 長いドキュメントをチャンクごとに翻訳
- **要約**: マルチレベル要約の生成

## TypeScriptサポート

FractoPはTypeScriptで書かれており、完全な型安全性を提供します：

```typescript
// アイテムタイプを定義
interface ExtractedItem {
  term: string;
  definition: string;
  confidence: number;
}

// 型付きプロセッサを作成
const processor = new FractalProcessor<ExtractedItem>(llm, config);

// 型安全なオプションで処理
const results = await processor.process<ExtractedItem>(text, {
  processChunk: async (chunk, context) => {
    // 戻り値の型が強制される
    return {
      items: extractedItems,
      summary: '正常に処理されました'
    };
  },
  getKey: (item) => item.term,  // 型安全なプロパティアクセス
});
```

## パフォーマンスの考慮事項

- **チャンクサイズ**: 大きなチャンクはより多くのトークンを使用するが、コンテキストをより良く維持
- **オーバーラップサイズ**: より多くのオーバーラップはコンテキストを保持するが、処理が増加
- **並列処理**: チャンクはコンテキストフローを維持するために逐次処理される
- **キャッシング**: 繰り返し処理のためのLLMレスポンスキャッシングの実装を検討

## ライセンス

MIT