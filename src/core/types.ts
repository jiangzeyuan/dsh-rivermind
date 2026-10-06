import type { AgentBudget } from './budget.js';

export type PlayerId = 'human' | 'iris';
export type Street = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export type Card = string;
export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; amount: number };
export type DecisionSource = 'human' | 'baseline' | 'dsh' | 'fallback';
export type Position = 'button' | 'big-blind';
export type BetSize = 'small' | 'medium' | 'large';
export interface ActionContext {
  position: Position;
  potBefore: number;
  toCall: number;
  facingBet: boolean;
  facingBetSize: BetSize | null;
  betSize: BetSize | null;
}
export interface DecisionTrace {
  budget?: AgentBudget;
  facts?: DecisionFacts;
  durationMs: number;
  tools: { name: string; status: 'ok' | 'error'; durationMs: number }[];
  memory?: { id: string; handsObserved: number; provided: boolean; retrieved: boolean; cited: boolean };
  equity?: { value: number; trials: number; assumption: string };
  failure?: 'timeout' | 'tool-budget' | 'runtime';
  runtimeError?: { kind: 'input-rejected' | 'agent-error' | 'no-action'; code?: string };
}
export interface Decision {
  action: Action;
  reason: string;
  source: DecisionSource;
  memoryIds: string[];
  trace?: DecisionTrace;
}
export interface HandEvent {
  id: number;
  handId: string;
  street: Street;
  kind: 'started' | 'blind' | 'action' | 'street' | 'refund' | 'finished';
  message: string;
  playerId?: PlayerId;
  action?: Action;
  amount?: number;
  source?: DecisionSource;
  reason?: string;
  memoryIds?: string[];
  context?: ActionContext;
  trace?: DecisionTrace;
}
export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: number | null;
  raise: { min: number; max: number; shortAllIn: boolean } | null;
}
export interface PlayerView {
  id: PlayerId;
  name: string;
  stack: number;
  streetBet: number;
  contributed: number;
  cards: (Card | null)[];
  dealer: boolean;
  folded: boolean;
}
export interface HandResult {
  winners: PlayerId[];
  reason: 'fold' | 'showdown';
  handName?: string;
  net: Record<PlayerId, number>;
}
export interface GameView {
  matchId: string;
  handId: string;
  handNumber: number;
  revision: number;
  street: Street;
  board: Card[];
  pot: number;
  smallBlind: number;
  bigBlind: number;
  actingPlayer: PlayerId | null;
  players: PlayerView[];
  legal: LegalActions;
  events: HandEvent[];
  result: HandResult | null;
  facts: DecisionFacts;
}
export interface DecisionFacts {
  position: Position;
  toCall: number;
  contestablePotAfterCall: number;
  uncalledReturnAfterCall: number;
  potOdds: number;
  effectiveStack: number;
  stackToPotRatioAfterCall: number;
}
export class PokerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'PokerError';
  }
}
