import type { BetSize, DecisionFacts, LegalActions, PlayerId, PlayerView } from './types.js';

export function betSizeBucket(ratio: number): BetSize {
  return ratio < 0.5 ? 'small' : ratio < 1 ? 'medium' : 'large';
}

// All inputs are public amounts; this never reads hole cards or the deck.
export function decisionFacts(players: PlayerView[], playerId: PlayerId, legal: LegalActions): DecisionFacts {
  const hero = players.find(player => player.id === playerId)!;
  const other = players.find(player => player.id !== playerId)!;
  const toCall = legal.call ?? 0;
  const contestablePotAfterCall = 2 * Math.min(hero.contributed + toCall, other.contributed);
  const totalAfterCall = hero.contributed + other.contributed + toCall;
  return {
    position: hero.dealer ? 'button' : 'big-blind', toCall, contestablePotAfterCall,
    uncalledReturnAfterCall: totalAfterCall - contestablePotAfterCall,
    potOdds: toCall / Math.max(1, contestablePotAfterCall),
    effectiveStack: Math.min(hero.stack + hero.contributed, other.stack + other.contributed) -
      Math.min(hero.contributed, other.contributed),
    stackToPotRatioAfterCall: Math.min(hero.stack - toCall, other.stack) / Math.max(1, contestablePotAfterCall),
  };
}
