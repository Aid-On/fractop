/**
 * fractop ベンチマーク — チャンク処理オーケストレーションの実効性能を計測する。
 *
 *   npm run benchmark            # 全シナリオ + サマリ表
 *   npm run benchmark -- --json  # 機械可読 JSON
 *   npm run benchmark -- --save  # bench/baseline.json に保存（before/after 比較用）
 *
 * LLM はモック（決定論的シードのレイテンシジッタ）に差し替え、
 * fractop 自身のオーケストレーション品質だけを測る:
 *   - wallMs        : 全体時間（LLM レイテンシの「隠し方」が表れる）
 *   - maxInFlight   : 同時 LLM 呼び出しのピーク（concurrency 契約の検証。429 リスクの代理指標）
 *   - llmCalls      : LLM 呼び出し回数（リトライ含む）
 *   - retryWaitMs   : リトライバックオフで眠っていた合計時間
 *   - items         : 抽出アイテム数（dedup 後。正しさの代理指標）
 *
 * text-smash の実態に合わせたパラメータ:
 *   chunkSize 6000 / 用語抽出 ~10件/チャンク / LLM レイテンシ 600±400ms
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FractalProcessor } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const save = args.includes('--save');

/** 決定論的 PRNG（再現性のため Math.random は使わない） */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 決定論的なコーパス（技術文書風の段落を連結） */
function buildCorpus(chars) {
  const sentences = [
    '本章では分散システムにおける合意形成アルゴリズムの基礎を述べる。',
    'Raft は理解可能性を設計目標としたリーダー選出ベースのプロトコルである。',
    'ログ複製の整合性はタームとインデックスの単調性によって保証される。',
    'ネットワーク分断時にはクォーラムを満たす側のみが書き込みを継続できる。',
    'スナップショットはログの無限成長を防ぐための圧縮機構である。',
    'クライアントはリーダーへリダイレクトされ、線形化可能な読み取りを得る。',
  ];
  let out = '';
  let i = 0;
  while (out.length < chars) {
    out += sentences[i % sentences.length];
    if (i % 4 === 3) out += '\n\n';
    i++;
  }
  return out.slice(0, chars);
}

/**
 * モック LLM: レイテンシ 600±400ms（シード付き）、in-flight を計測。
 * failEvery を指定すると N 回に 1 回、一時エラー（429 相当）を返す。
 */
function createMockLLM({ seed = 42, baseMs = 600, jitterMs = 400, failEvery = 0 } = {}) {
  const rand = mulberry32(seed);
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0 };
  return {
    stats,
    async chat(_system, userPrompt) {
      stats.calls++;
      const n = stats.calls;
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      const latency = baseMs + rand() * jitterMs;
      await new Promise((r) => setTimeout(r, latency));
      stats.inFlight--;
      if (failEvery > 0 && n % failEvery === 0) {
        throw new Error('rate limited (simulated 429)');
      }
      // チャンク内容に応じた決定論的な「用語」を 10 件返す（一部は全チャンク共通 → dedup を運動させる）
      const h = [...userPrompt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
      const terms = Array.from({ length: 10 }, (_, k) =>
        k < 3 ? `共通用語${k}` : `用語${(h + k * 977) % 100000}`,
      );
      return JSON.stringify(terms.map((t) => ({ term: t, definition: `${t}の定義` })));
    },
  };
}

/** text-smash の term-extractor 相当の ProcessOptions */
function termOptions(llm) {
  return {
    generateContext: async () => {
      await llm.chat('context', 'summarize');
      return '文書全体の要約コンテキスト';
    },
    processChunk: async (chunk, ctx) => {
      const res = await llm.chat('extract terms', `${ctx.globalContext}\n${chunk.slice(0, 200)}#${ctx.index}`);
      return { items: JSON.parse(res), summary: undefined };
    },
    mergeResults: (results) => {
      const items = results.flat();
      return { items, needsSupplement: false };
    },
    getKey: (item) => item.term,
  };
}

async function run(name, { chars, config, mock }) {
  const llm = createMockLLM(mock);
  const processor = new FractalProcessor(llm, config);
  let retryWaitMs = 0;
  let retries = 0;
  processor.on((e) => {
    if (e.type === 'chunk_retry') {
      retries++;
      // withRetry の待機を再現計算（attempt は 1 始まりで emit される）
      const attempt = e.attempt - 1;
      const cap = config.maxRetryDelay ?? Infinity;
      retryWaitMs += Math.min((config.retryDelay ?? 1000) * 2 ** attempt, cap);
    }
  });

  const text = buildCorpus(chars);
  const t0 = performance.now();
  const result = await processor.processWithMetadata(text, termOptions(llm));
  const wallMs = performance.now() - t0;

  return {
    name,
    chunks: result.chunksProcessed + result.chunksFailed,
    wallMs: +wallMs.toFixed(0),
    maxInFlight: llm.stats.maxInFlight,
    llmCalls: llm.stats.calls,
    retries,
    retryWaitMs: +retryWaitMs.toFixed(0),
    items: result.items.length,
    chunksFailed: result.chunksFailed,
    breaker: result.circuitBreakerTripped,
  };
}

const CORPUS = 300_000; // ≒ 50 チャンク（chunkSize 6000）— text-smash の大きめ PDF 相当

const scenarios = [
  // text-smash 現行（直列・デフォルト設定）
  { name: 'sequential', chars: CORPUS, config: {}, mock: {} },
  // 並列の契約検証: concurrency=3 なら maxInFlight も 3 のはず
  { name: 'parallel c=3', chars: CORPUS, config: { parallelProcessing: true, concurrency: 3 }, mock: {} },
  { name: 'parallel c=6', chars: CORPUS, config: { parallelProcessing: true, concurrency: 6 }, mock: {} },
  // 一時エラー（429 相当）下のリトライ挙動: 12 回に 1 回失敗
  {
    name: 'flaky seq',
    chars: CORPUS,
    config: { retryDelay: 1000 },
    mock: { failEvery: 12 },
  },
  {
    name: 'flaky par c=3',
    chars: CORPUS,
    config: { parallelProcessing: true, concurrency: 3, retryDelay: 1000 },
    mock: { failEvery: 12 },
  },
];

const results = [];
for (const s of scenarios) {
  results.push(await run(s.name, s));
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pad = (v, n) => String(v ?? '').padStart(n);
  console.log('fractop benchmark  (mock LLM 600±400ms, corpus 300k chars ≒ 50 chunks)');
  console.log('─'.repeat(96));
  console.log(
    `${'scenario'.padEnd(16)}${pad('chunks', 7)}${pad('wall', 9)}${pad('maxInFl', 8)}${pad('llmCalls', 9)}${pad('retries', 8)}${pad('retryWait', 10)}${pad('items', 7)}${pad('failed', 7)}`,
  );
  console.log('─'.repeat(96));
  for (const r of results) {
    console.log(
      `${r.name.padEnd(16)}${pad(r.chunks, 7)}${pad((r.wallMs / 1000).toFixed(1) + 's', 9)}${pad(r.maxInFlight, 8)}${pad(r.llmCalls, 9)}${pad(r.retries, 8)}${pad((r.retryWaitMs / 1000).toFixed(1) + 's', 10)}${pad(r.items, 7)}${pad(r.chunksFailed, 7)}${r.breaker ? '  BREAKER' : ''}`,
    );
  }
  console.log('─'.repeat(96));
  console.log('検証ポイント: maxInFl が concurrency と一致するか（一致しない＝並列度制限が機能していない）');
}

if (save) {
  const out = resolve(here, 'baseline.json');
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  console.error(`saved → ${out}`);
}
