import type { Card, GameView, HandEvent, PlayerId, Street } from '../core/types.js';
export interface ReplayFrame {
  street: Street; board: Card[]; pot: number; events: HandEvent[];
  players: { id: PlayerId; name: string; stack: number; cards: (Card | null)[] }[];
}
export function replayFrame(view: GameView, count: number): ReplayFrame {
  const events = view.events.slice(0, Math.max(0, Math.min(view.events.length, count)));
  const stacks = new Map(view.players.map(p => [p.id, p.stack - (view.result?.net[p.id] ?? 0)]));
  let pot = 0, street: Street = 'preflop', board: Card[] = [], finished = false;
  for (const event of events) {
    street = event.street;
    if (event.kind === 'street') board = view.board.slice(0, event.street === 'flop' ? 3 : event.street === 'turn' ? 4 : 5);
    if (event.playerId && (event.kind === 'blind' || event.kind === 'action') && event.amount) {
      stacks.set(event.playerId, stacks.get(event.playerId)! - event.amount); pot += event.amount;
    }
    if (event.kind === 'refund' && event.playerId && event.amount) {
      stacks.set(event.playerId, stacks.get(event.playerId)! + event.amount); pot -= event.amount;
    }
    if (event.kind === 'finished') {
      finished = true;
      for (const p of view.players) stacks.set(p.id, p.stack);
    }
  }
  return { street, board, pot, events, players: view.players.map(p => ({ id: p.id, name: p.name, stack: stacks.get(p.id)!,
    cards: events.length > 0 && (p.id === 'human' || (finished && view.result?.reason === 'showdown')) ? p.cards : p.cards.map(() => null) })) };
}
