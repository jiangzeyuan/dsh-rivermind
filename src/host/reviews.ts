import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PokerError, type GameView, type HandResult } from '../core/types.js';
import type { OpponentMemory } from './memory.js';

export interface SavedReview { view: GameView; memoryBeforeUpdate: OpponentMemory }
export interface HandSummary { handId: string; handNumber: number; result: HandResult }
export interface HistoryPage { hands: HandSummary[]; truncated: boolean }
const MAX_RECORDS = 100;
const MAX_BYTES = 2 * 1024 * 1024;

export class ReviewStore {
  #records: SavedReview[] = [];
  #truncated = false;
  readonly path: string;
  constructor(dataDir: string) {
    this.path = join(dataDir, 'reviews.jsonl');
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    const start = Math.max(0, size - MAX_BYTES);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(this.path, 'r');
    try { readSync(fd, buffer, 0, buffer.length, start); } finally { closeSync(fd); }
    const text = buffer.toString('utf8');
    const lines = (start > 0 ? text.slice(text.indexOf('\n') + 1) : text).split('\n').filter(Boolean);
    this.#truncated = start > 0 || lines.length > MAX_RECORDS;
    for (const line of lines.slice(-MAX_RECORDS)) {
      const record = JSON.parse(line) as SavedReview;
      if (!record.view || record.view.street !== 'complete' || !record.view.result || typeof record.view.handId !== 'string' ||
          !Array.isArray(record.view.players) || !Array.isArray(record.view.events) || !record.memoryBeforeUpdate) {
        throw new Error('复盘记录格式错误；请保留 reviews.jsonl 并检查。');
      }
      // Older logs have no facts/context. Never reveal a folded opponent's cards.
      if (record.view.result.reason === 'fold') {
        const iris = record.view.players.find(player => player.id === 'iris');
        if (iris) iris.cards = iris.cards.map(() => null);
      }
      this.#records.push(record);
    }
  }
  append(record: SavedReview): void {
    if (this.#records.some(item => item.view.handId === record.view.handId)) return;
    appendFileSync(this.path, JSON.stringify(record) + '\n', { mode: 0o600 });
    this.#records.push(structuredClone(record));
    if (this.#records.length > MAX_RECORDS) { this.#records.shift(); this.#truncated = true; }
  }
  list(limit = 50): HistoryPage {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECORDS) throw new PokerError('BAD_LIMIT', '历史条数须为 1～100。', 400);
    const records = this.#records.slice(-limit).reverse();
    return { hands: records.map(({ view }) => ({ handId: view.handId, handNumber: view.handNumber, result: structuredClone(view.result!) })),
      truncated: this.#truncated || this.#records.length > limit };
  }
  get(handId: unknown): SavedReview {
    if (typeof handId !== 'string' || handId.length > 100) throw new PokerError('BAD_HAND_ID', '无效的手牌编号。', 400);
    const record = this.#records.find(item => item.view.handId === handId);
    if (!record) throw new PokerError('REVIEW_NOT_FOUND', '该手尚未结束，或不在最近复盘窗口内。', 404);
    return structuredClone(record);
  }
}
