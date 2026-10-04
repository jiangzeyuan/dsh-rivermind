import { assertDeck, compareRanks, evaluate, HAND_NAMES, shuffledDeck } from './cards.js';
import { betSizeBucket, decisionFacts } from './facts.js';
import { PokerError, type Action, type Card, type Decision, type GameView, type HandEvent,
  type HandResult, type LegalActions, type PlayerId, type Street } from './types.js';

const IDS: PlayerId[] = ['human', 'iris'];
const NAMES = ['你', 'Iris'];
const NO_ACTIONS: LegalActions = { fold: false, check: false, call: null, raise: null };

export class PokerTable {
  readonly matchId = crypto.randomUUID();
  #handNumber = 0;
  #revision = 0;
  #street: Street = 'idle';
  #button = 0;
  #actor: number | null = null;
  #deck: Card[] = [];
  #board: Card[] = [];
  #holes: Card[][] = [[], []];
  #stacks: number[];
  #startingStacks: number[] = [];
  #bets = [0, 0];
  #contributed = [0, 0];
  #folded = [false, false];
  #pending = new Set<number>();
  #currentBet = 0;
  #lastRaise: number;
  #events: HandEvent[] = [];
  #result: HandResult | null = null;
  #showdown = false;

  constructor(private readonly options: { stacks?: [number, number]; smallBlind?: number;
    bigBlind?: number; deckFactory?: () => Card[]; initialButton?: 0 | 1 } = {}) {
    this.#stacks = [...(options.stacks ?? [2000, 2000])];
    this.#lastRaise = this.bigBlind;
    if (!Number.isSafeInteger(this.smallBlind) || !Number.isSafeInteger(this.bigBlind) ||
        this.smallBlind < 1 || this.bigBlind <= this.smallBlind ||
        this.#stacks.some(stack => !Number.isSafeInteger(stack) || stack < this.bigBlind) ||
        !Number.isSafeInteger(this.#stacks[0]! + this.#stacks[1]!)) {
      throw new Error('非法筹码或盲注配置。');
    }
  }
  get smallBlind(): number { return this.options.smallBlind ?? 10; }
  get bigBlind(): number { return this.options.bigBlind ?? 20; }
  get revision(): number { return this.#revision; }
  get handId(): string { return this.matchId + ':' + this.#handNumber; }
  get actingPlayer(): PlayerId | null { return this.#actor === null ? null : IDS[this.#actor]!; }
  get complete(): boolean { return this.#street === 'complete'; }

  newHand(expectedRevision: number): void {
    this.assertRevision(expectedRevision);
    if (this.#street !== 'idle' && !this.complete) throw new PokerError('HAND_ACTIVE', '请先完成当前手牌。');
    if (this.#stacks.some(stack => stack < this.bigBlind)) throw new PokerError('BUY_IN_REQUIRED', '有玩家筹码不足，请重新开始训练。');
    const deck = (this.options.deckFactory ?? shuffledDeck)();
    assertDeck(deck); // Validate before mutating any table state.
    this.#deck = [...deck];
    this.#button = (this.#handNumber + (this.options.initialButton ?? 0)) % 2;
    this.#handNumber++;
    this.#revision++;
    this.#street = 'preflop';
    this.#board = [];
    this.#holes = [[], []];
    this.#startingStacks = [...this.#stacks];
    this.#bets = [0, 0];
    this.#contributed = [0, 0];
    this.#folded = [false, false];
    this.#events = [];
    this.#result = null;
    this.#showdown = false;
    this.#currentBet = this.bigBlind;
    this.#lastRaise = this.bigBlind;
    for (let i = 0; i < 4; i++) this.#holes[(1 - this.#button + i) % 2]!.push(this.draw());
    this.event({ kind: 'started', message: '第 ' + this.#handNumber + ' 手牌开始' });
    this.commit(this.#button, this.smallBlind);
    this.event({ kind: 'blind', playerId: IDS[this.#button]!, amount: this.smallBlind, message: NAMES[this.#button] + ' 支付小盲 ' + this.smallBlind });
    const big = 1 - this.#button;
    this.commit(big, this.bigBlind);
    this.event({ kind: 'blind', playerId: IDS[big]!, amount: this.bigBlind, message: NAMES[big] + ' 支付大盲 ' + this.bigBlind });
    this.#pending = new Set([this.#button, big]);
    this.#actor = this.#button;
    this.progress();
  }
  assertRevision(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected !== this.#revision) throw new PokerError('STALE_TURN', '牌局已更新，请刷新后行动。');
  }
  legalFor(playerId: PlayerId): LegalActions {
    const i = IDS.indexOf(playerId);
    if (i < 0 || i !== this.#actor || this.complete || this.#street === 'idle') return { ...NO_ACTIONS };
    const owed = Math.max(0, this.#currentBet - this.#bets[i]!);
    const ownMax = this.#bets[i]! + this.#stacks[i]!;
    const other = 1 - i;
    const max = ownMax;
    const fullMin = this.#currentBet + this.#lastRaise;
    const shortAllIn = ownMax < fullMin && max === ownMax && max > this.#currentBet;
    return {
      fold: true, check: owed === 0, call: owed > 0 ? Math.min(owed, this.#stacks[i]!) : null,
      raise: max > this.#currentBet && this.#stacks[other]! > 0 && (max >= fullMin || shortAllIn)
        ? { min: shortAllIn ? max : fullMin, max, shortAllIn } : null,
    };
  }
  apply(playerId: PlayerId, decision: Decision, expectedRevision: number): void {
    this.assertRevision(expectedRevision);
    const i = IDS.indexOf(playerId);
    if (this.#actor !== i || i < 0 || this.complete) throw new PokerError('NOT_YOUR_TURN', '尚未轮到该玩家行动。');
    const legal = this.legalFor(playerId);
    const action: Action = decision.action;
    if (!action || !['fold', 'check', 'call', 'raise'].includes(action.type)) throw new PokerError('INVALID_ACTION', '非法行动类型。', 400);
    if ((action.type === 'check' && !legal.check) || (action.type === 'call' && legal.call === null) ||
        (action.type === 'raise' && (!legal.raise || !Number.isSafeInteger(action.amount) ||
          action.amount < legal.raise.min || action.amount > legal.raise.max))) {
      throw new PokerError('ILLEGAL_ACTION', '该行动或下注金额不符合当前规则。', 400);
    }
    const potBefore = this.#contributed.reduce((sum, value) => sum + value, 0);
    const opposingBet = this.#events.findLast(event => event.street === this.#street && event.kind === 'action' &&
      event.playerId !== playerId && event.action?.type === 'raise');
    const facingBet = (legal.call ?? 0) > 0 && !!opposingBet;
    this.#revision++;
    let amount = 0;
    if (action.type === 'fold') {
      this.#folded[i] = true;
    } else if (action.type === 'call') {
      amount = legal.call!;
      this.commit(i, amount);
      this.#pending.delete(i);
    } else if (action.type === 'check') {
      this.#pending.delete(i);
    } else {
      amount = action.amount - this.#bets[i]!;
      const raiseSize = action.amount - this.#currentBet;
      this.commit(i, amount);
      if (raiseSize >= this.#lastRaise) this.#lastRaise = raiseSize;
      this.#currentBet = action.amount;
      this.#pending = new Set([1 - i]);
    }
    const label = action.type === 'fold' ? '弃牌' : action.type === 'check' ? '过牌' :
      action.type === 'call' ? '跟注 ' + amount : '下注至 ' + (action as { amount: number }).amount;
    this.event({ kind: 'action', playerId, action: structuredClone(action), amount,
      message: NAMES[i] + ' ' + label, source: decision.source, reason: decision.reason.slice(0, 500),
      memoryIds: [...decision.memoryIds].slice(0, 8), trace: decision.trace ? structuredClone(decision.trace) : undefined,
      context: { position: i === this.#button ? 'button' : 'big-blind', potBefore, toCall: legal.call ?? 0,
        facingBet, facingBetSize: facingBet ? opposingBet?.context?.betSize ?? null : null,
        betSize: action.type === 'raise' ? betSizeBucket(amount / Math.max(1, potBefore)) : null } });
    if (action.type === 'fold') {
      this.finish([1 - i], 'fold');
      return;
    }
    this.#actor = 1 - i;
    this.progress();
  }
  viewFor(playerId: PlayerId, includeReview = false): GameView {
    if (!IDS.includes(playerId)) throw new PokerError('UNKNOWN_PLAYER', '未知玩家。', 403);
    const review = includeReview && playerId === 'human' && this.complete;
    const players = IDS.map((id, i) => ({
      id, name: NAMES[i]!, stack: this.#stacks[i]!, streetBet: this.#bets[i]!,
      contributed: this.#contributed[i]!, dealer: i === this.#button, folded: this.#folded[i]!,
      cards: id === playerId || this.#showdown ? [...this.#holes[i]!] : this.#holes[i]!.map(() => null),
    }));
    const legal = this.legalFor(playerId);
    return {
      matchId: this.matchId, handId: this.handId, handNumber: this.#handNumber,
      revision: this.#revision, street: this.#street, board: [...this.#board],
      pot: this.#contributed.reduce((sum, value) => sum + value, 0),
      smallBlind: this.smallBlind, bigBlind: this.bigBlind, actingPlayer: this.actingPlayer,
      players, legal, facts: decisionFacts(players, playerId, legal),
      events: this.#events.map(event => {
        const { reason, memoryIds, trace, ...visible } = event;
        return review ? structuredClone(event) : structuredClone(visible);
      }),
      result: this.#result ? structuredClone(this.#result) : null,
    };
  }
  publicHistory(): HandEvent[] {
    return this.#events.map(({ reason, memoryIds, trace, ...event }) => structuredClone(event));
  }
  private event(event: Omit<HandEvent, 'id' | 'handId' | 'street'>): void {
    this.#events.push({ id: this.#events.length + 1, handId: this.handId, street: this.#street, ...event });
  }
  private draw(): Card {
    const card = this.#deck.shift();
    if (!card) throw new Error('牌组耗尽。');
    return card;
  }
  private commit(i: number, amount: number): void {
    this.#stacks[i] = this.#stacks[i]! - amount;
    this.#bets[i] = this.#bets[i]! + amount;
    this.#contributed[i] = this.#contributed[i]! + amount;
  }
  private progress(): void {
    for (const i of this.#pending) {
      if (this.#stacks[i] === 0 || (this.#stacks[1 - i] === 0 && this.#bets[i]! >= this.#currentBet)) this.#pending.delete(i);
    }
    if (this.#pending.size) {
      if (this.#actor === null || !this.#pending.has(this.#actor)) this.#actor = [...this.#pending][0]!;
      return;
    }
    if (this.#street === 'river') { this.showdown(); return; }
    if (this.#stacks.some(stack => stack === 0)) {
      while (this.#board.length < 5) this.dealStreet();
      this.showdown();
      return;
    }
    this.dealStreet();
    this.#bets = [0, 0];
    this.#currentBet = 0;
    this.#lastRaise = this.bigBlind;
    this.#pending = new Set([0, 1]);
    this.#actor = 1 - this.#button;
  }
  private dealStreet(): void {
    this.draw(); // Burn card.
    if (this.#street === 'preflop') {
      this.#street = 'flop'; this.#board.push(this.draw(), this.draw(), this.draw());
    } else if (this.#street === 'flop') {
      this.#street = 'turn'; this.#board.push(this.draw());
    } else if (this.#street === 'turn') {
      this.#street = 'river'; this.#board.push(this.draw());
    } else throw new Error('非法发牌阶段。');
    this.event({ kind: 'street', message: '公共牌更新：' + this.#board.join(' ') });
  }
  private showdown(): void {
    const ranks = this.#holes.map(hole => evaluate([...hole, ...this.#board]));
    const comparison = compareRanks(ranks[0]!, ranks[1]!);
    this.#showdown = true;
    this.finish(comparison > 0 ? [0] : comparison < 0 ? [1] : [1 - this.#button, this.#button],
      'showdown', HAND_NAMES[ranks[comparison >= 0 ? 0 : 1]![0]!]!);
  }
  private finish(winners: number[], reason: 'fold' | 'showdown', handName?: string): void {
    const matched = Math.min(...this.#contributed);
    for (let i = 0; i < 2; i++) {
      const returned = this.#contributed[i]! - matched;
      if (returned > 0) {
        this.#stacks[i] = this.#stacks[i]! + returned;
        this.#bets[i] = this.#bets[i]! - returned;
        this.#contributed[i] = matched;
        this.event({ kind: 'refund', playerId: IDS[i]!, amount: returned,
          message: NAMES[i] + ' 收回未被跟注的 ' + returned });
      }
    }
    const pot = this.#contributed.reduce((sum, value) => sum + value, 0);
    const each = Math.floor(pot / winners.length);
    winners.forEach((i, n) => { this.#stacks[i] = this.#stacks[i]! + each + (n === 0 ? pot % winners.length : 0); });
    this.#result = { winners: winners.map(i => IDS[i]!), reason, ...(handName ? { handName } : {}),
      net: { human: this.#stacks[0]! - this.#startingStacks[0]!, iris: this.#stacks[1]! - this.#startingStacks[1]! } };
    this.#street = 'complete';
    this.#actor = null;
    this.#pending.clear();
    this.event({ kind: 'finished', message: winners.length > 1 ? '双方平分底池' :
      NAMES[winners[0]!] + ' 赢得底池 ' + pot + (handName ? ' · ' + handName : ' · 对手弃牌') });
  }
}
