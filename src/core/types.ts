export type PlayerId = 'human' | 'iris';
export type Street = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export type Card = string;
export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; amount: number };
export type DecisionSource = 'human' | 'baseline' | 'dsh' | 'fallback';
export interface Decision {
  action: Action;
  reason: string;
  source: DecisionSource;
  memoryIds: string[];
}
export interface HandEvent {
  id: number;
  handId: string;
  street: Street;
  kind: 'started' | 'blind' | 'action' | 'street' | 'finished';
  message: string;
  playerId?: PlayerId;
  action?: Action;
  amount?: number;
  source?: DecisionSource;
  reason?: string;
  memoryIds?: string[];
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
}
export class PokerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'PokerError';
  }
}
