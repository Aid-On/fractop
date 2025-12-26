# @aid-on/fractop

[![npm version](https://badge.fury.io/js/@aid-on%2Ffractop.svg)](https://www.npmjs.com/package/@aid-on/fractop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)

日本語 | [English](./README.md)

FractoP (Fractal Processor) - ストリーミング、バッチ処理、フラクタルチャンキングを備えたLLM向けのエレガントなテキスト処理。

## 🚨 問題

**LLMにはコンテキスト制限があります。** GPT-4は128Kトークンが上限。Claudeは200K。Geminiの2Mコンテキストでもすぐに埋まります。

次のような場合どうしますか？
- 500ページのPDFを要約したい？
- 10,000ファイルのコードベースを解析したい？
- 本を丸ごと翻訳したい？
- 数百万件のカスタマーレビューを処理したい？

```typescript
// ❌ これは失敗します
const summary = await llm.process(entire500PagePDF);
// Error: Context length exceeded (400,000 tokens > 128,000 limit)
```

## ✅ 解決策：FractoP

FractoPは賢くテキストをチャンク分割し、各部分を処理し、結果をマージします - すべてコンテキストを保持しながら。

```typescript
// ✅ どんなサイズのドキュメントでも動作
const summary = await fractop()
  .withLLM(llm)
  .chunking({ size: 3000, overlap: 300 })
  .parallel(5)
  .run(entire500PagePDF);
```

## ✨ 特徴

- **🎯 Fluent API**: エレガントなチェーン可能インターフェース
- **🌊 Nagareストリーミング**: `Stream<T>`統合によるリアクティブストリーム処理
- **🔄 スマートチャンキング**: コンテキスト保持のためのオーバーラップ付き賢い分割
- **⚡ 並列処理**: 最大パフォーマンスのための並行チャンク処理
- **🛡️ エンタープライズ信頼性**: タイムアウト、リトライ、サーキットブレーカー内蔵
- **🎨 UnillM統合**: UnillMアダプター経由で任意のLLMとシームレスに動作
- **📦 バッチ処理**: 複数ドキュメントを効率的に処理
- **🔁 自動リトライ**: 一時的な障害に対する指数バックオフ

## インストール

```bash
npm install @aid-on/fractop
```

## 🚀 クイックスタート

### 主要インターフェース - Fluent API

FractoPを使う最もエレガントな方法：

```typescript
import { fractop } from '@aid-on/fractop';

// シンプルでエレガント
const results = await fractop()
  .withLLM(async (chunk) => {
    // あなたのLLMロジック
    const response = await callYourLLM(chunk);
    return response;
  })
  .chunking({ size: 3000, overlap: 300 })
  .parallel(5)
  .retry(3, 1000)
  .timeout(30000)
  .run(longText);
```

### GROQ/OpenAIと使用

```typescript
const summaries = await fractop()
  .withLLM(async (chunk) => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: '簡潔に要約してください。' },
          { role: 'user', content: chunk }
        ]
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  })
  .chunking({ size: 2000, overlap: 200 })
  .run(document);
```

### UnillMと使用

```typescript
// UnillM設定オブジェクト
const results = await fractop()
  .withLLM({
    model: 'groq:llama-3.1-70b',
    credentials: { groqApiKey: process.env.GROQ_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'キーポイントを抽出してください。' },
      { role: 'user', content: chunk }
    ],
    options: { temperature: 0.7 }
  })
  .chunking({ size: 3000 })
  .parallel(3)
  .run(text);

// カスタム変換も可能
const entities = await fractop<Entity[]>()
  .withLLM({
    model: 'anthropic:claude-3-5-haiku',
    credentials: { anthropicApiKey: process.env.ANTHROPIC_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'エンティティをJSONとして抽出。' },
      { role: 'user', content: chunk }
    ],
    transform: (response) => JSON.parse(response.text)
  })
  .run(document);
```

## 💡 実例

### 📚 500ページの研究論文を要約

```typescript
const paper = readFileSync('quantum-computing-thesis.pdf', 'utf-8');
// 200,000文字以上 - 直接LLM呼び出しは失敗

const summary = await fractop()
  .withLLM({
    model: 'groq:llama-3.1-70b',
    credentials: { groqApiKey: process.env.GROQ_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: '重要な発見を要約。簡潔に。' },
      { role: 'user', content: chunk }
    ]
  })
  .chunking({ size: 3000, overlap: 300 })
  .parallel(5)  // 5チャンクを同時処理
  .run(paper);

// 要約を最終文書にマージ
const finalSummary = summary.join('\n\n');
```

### 🔍 1000以上のファイルのコードベース解析

```typescript
const files = globSync('src/**/*.ts');  // 1000以上のTypeScriptファイル
const fullCode = files.map(f => readFileSync(f)).join('\n');
// 数百万文字 - 単一LLM呼び出しは不可能

// 全APIエンドポイントを抽出
const endpoints = await fractop()
  .withLLM({
    model: 'anthropic:claude-3-5-haiku',
    credentials: { anthropicApiKey: API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'REST APIエンドポイントをJSONとして抽出。' },
      { role: 'user', content: chunk }
    ],
    transform: (res) => JSON.parse(res.text)
  })
  .chunking({ size: 4000, overlap: 500 })  // オーバーラップでエンドポイント見逃しを防ぐ
  .parallel(10)  // 10ファイル同時解析
  .run(fullCode);

// 結果の重複排除
const uniqueEndpoints = [...new Set(endpoints.flat())];
console.log(`${uniqueEndpoints.length}個のAPIエンドポイントを発見`);
```

### 🌐 本まるごと翻訳

```typescript
const book = await fetch('https://gutenberg.org/files/2600/2600-0.txt')
  .then(r => r.text());  // 戦争と平和 - 320万文字！

const translatedBook = await fractop()
  .withLLM({
    model: 'gemini:gemini-2.5-pro',
    credentials: { geminiApiKey: process.env.GEMINI_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: '日本語に翻訳。文学的スタイルを維持。' },
      { role: 'user', content: chunk }
    ]
  })
  .chunking({ 
    size: 2000,      // 品質のため小さめのチャンク
    overlap: 200     // 文の流れを保持
  })
  .retry(3, 2000)    // 失敗チャンクをリトライ
  .timeout(120000)   // チャンクあたり2分のタイムアウト
  .run(book);

writeFileSync('戦争と平和.txt', translatedBook.join(''));
```

### 📊 5万件のカスタマーレビュー処理

```typescript
// データベースから5万件のサポートチケット
const tickets = await db.query('SELECT * FROM tickets LIMIT 50000');
const ticketTexts = tickets.map(t => t.content);

// ストリーミングでバッチ処理
const analysis = await fractopBatch(ticketTexts)
  .withLLM({
    model: 'groq:llama-3.1-8b-instant',  // 高ボリューム用の高速モデル
    credentials: { groqApiKey: API_KEY },
    messages: (ticket) => [
      { role: 'system', content: '出力: 感情|カテゴリ|優先度' },
      { role: 'user', content: ticket }
    ],
    transform: (res) => {
      const [sentiment, category, priority] = res.text.split('|');
      return { sentiment, category, priority };
    }
  })
  .collectAll();

// インサイトを集計
const insights = {
  sentiments: { positive: 0, negative: 0, neutral: 0 },
  categories: new Map(),
  highPriority: []
};

for (const [ticket, results] of analysis) {
  results.forEach(r => {
    insights.sentiments[r.sentiment]++;
    if (r.priority === 'high') insights.highPriority.push(ticket);
  });
}
```

### 🤖 大規模コンポーネントのテスト生成

```typescript
const component = readFileSync('src/Dashboard.tsx', 'utf-8');
// 5000行のReactコンポーネント

const tests = await fractop()
  .withLLM({
    model: 'openai:gpt-4o',
    credentials: { openaiApiKey: process.env.OPENAI_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'React Testing LibraryでJestユニットテストを生成。' },
      { role: 'user', content: chunk }
    ]
  })
  .chunking({ size: 1500 })  // 各チャンクに的を絞ったテスト
  .parallel(3)
  .run(component);

// テストスイートに結合
const testFile = `
describe('Dashboard Component', () => {
  ${tests.join('\n\n')}
});
`;
writeFileSync('Dashboard.test.tsx', testFile);
```

### 💬 リアルタイムドキュメントQ&A

```typescript
async function askDocument(doc: string, question: string) {
  // ドキュメントをストリーミングして答えを探す
  return await fractopStream(doc)
    .withLLM({
      model: 'gemini:gemini-2.5-flash',  // リアルタイム用の高速モデル
      credentials: { geminiApiKey: API_KEY },
      messages: (chunk) => [
        { role: 'user', content: `「${question}」に答えて: ${chunk}` }
      ]
    })
    .chunking({ size: 3000, overlap: 500 })
    .stream()
    .filter(answer => answer.length > 20)  // 関連する答えをフィルタ
    .take(3)  // 最初の3つの良い答え
    .collect();
}

// 使用例
const manual = readFileSync('kubernetes-manual.txt', 'utf-8');
const answers = await askDocument(manual, "オートスケーリングの設定方法は？");
// 数分ではなく数秒で返答！
```

## 🌊 Nagareでストリーミング

メモリ効率的なストリーミングで大規模ドキュメントを処理：

```typescript
import { fractopStream } from '@aid-on/fractop';

// 処理されるごとに結果をストリーム
const stream = fractopStream(largeDocument)
  .withLLM(async (chunk) => await processChunk(chunk))
  .chunking({ size: 2000, overlap: 200 })
  .parallel(3)
  .stream();

// リアクティブストリーム操作
await stream
  .map(result => result.toUpperCase())
  .filter(result => result.length > 100)
  .take(10)
  .collect();
```

## ⚙️ 設定

### デフォルト設定

```typescript
{
  chunkSize: 3000,        // LLMトークン制限に最適化
  overlapSize: 300,       // コンテキスト保持
  concurrency: 3,         // 並列処理スレッド
  maxRetries: 2,          // リトライ試行回数
  retryDelay: 1000,       // 初期リトライ遅延（ミリ秒）
  chunkTimeout: 30000     // チャンクごとのタイムアウト（ミリ秒）
}
```

## 📦 API リファレンス

### Fluent APIメソッド

| メソッド | 説明 |
|--------|-------------|
| `.withLLM(fn\|config)` | LLMプロセッサを設定（関数またはUnillM設定） |
| `.chunking(opts)` | チャンクサイズとオーバーラップを設定 |
| `.parallel(n)` | 並列処理を有効化 |
| `.retry(n, delay)` | リトライ動作を設定 |
| `.timeout(ms, perChunk?)` | タイムアウト制限を設定 |
| `.run(text)` | 処理を実行 |

## 🚀 パフォーマンスのヒント

1. **チャンクサイズ**: コンテキストとトークン制限のバランス（2000-4000文字推奨）
2. **オーバーラップ**: チャンクサイズの10-20%で良好なコンテキスト保持
3. **並行性**: LLMレート制限に合わせる（ほとんどのプロバイダーで3-5）
4. **ストリーミング**: 100KB以上のドキュメントには`fractopStream`を使用
5. **バッチング**: 複数ドキュメントには`fractopBatch`を使用

## ライセンス

MIT