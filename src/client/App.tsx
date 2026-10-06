import { useEffect, useRef, useState } from 'react';
import type { Action, Card as CardValue } from '../core/types.js';
import type { TableSnapshot } from '../host/service.js';
import type { PokerApi } from './api.js';
import { ReviewPanel } from './ReviewPanel.js';
import { TraceExport } from './TraceExport.js';
import { ModelHelp } from './ModelHelp.js';
import { MemoryEvidence } from './MemoryEvidence.js';
import { memoryDiagnostics } from '../core/diagnostics.js';
import { BetControls } from './BetControls.js';
import { IrisSettings, ThinkingStatus } from './IrisSettings.js';

const STREET_NAMES = { idle: '准备开始', preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', complete: '本手结束' };
const SOURCE_NAMES = { human: '玩家', baseline: '规则陪练', dsh: 'DSH Agent', fallback: '安全兜底' };
const SUIT_NAMES: Record<string, string> = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
function Card({ value, small = false, empty = false }: { value: CardValue | null; small?: boolean; empty?: boolean }) {
  const suit = value?.[1] ?? '';
  const rank = value?.[0] === 'T' ? '10' : value?.[0];
  return <div className={'rm-card' + (small ? ' rm-card-small' : '') + (!value ? empty ? ' rm-card-empty' : ' rm-card-back' : '') +
    ('hd'.includes(suit) && suit ? ' rm-card-red' : '')} aria-label={value ? (SUIT_NAMES[suit] ?? '') + rank : empty ? '待发公共牌' : '未公开的底牌'}>
    {value ? <><span className="rm-card-corner">{rank}<small>{SUIT_SYMBOLS[suit]}</small></span><span className="rm-card-suit">{SUIT_SYMBOLS[suit]}</span></>
      : empty ? <span>·</span> : <span className="rm-card-pattern">R</span>}
  </div>;
}
function signed(value: number): string { return (value > 0 ? '+' : '') + value; }
export function App({ api, embedded = false }: { api: PokerApi; embedded?: boolean }) {
  const [state, setState] = useState<TableSnapshot | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<'events' | 'memory' | 'review'>('events');
  const [reviewHandId, setReviewHandId] = useState<string | null>(null);
  const openEvidence = (handId: string) => { setReviewHandId(handId); setTab('review'); };
  const alive = useRef(true);
  const mutating = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!alive.current) return;
      if (!mutating.current) {
        const request = ++sequence.current;
        try {
          const next = await api('state');
          if (alive.current && request === sequence.current) { setState(next); setError(''); }
        } catch (e) { if (alive.current && request === sequence.current) setError(e instanceof Error ? e.message : '连接失败。'); }
      }
      if (alive.current) timer = setTimeout(poll, 750);
    };
    void poll();
    return () => { alive.current = false; sequence.current++; clearTimeout(timer); };
  }, [api]);
  async function command(endpoint: string, payload: Record<string, unknown> = {}) {
    if (mutating.current || !state) return;
    mutating.current = true; setSending(true); setError('');
    const request = ++sequence.current;
    try {
      const next = await api(endpoint, { revision: state.revision, handId: state.handId, ...payload });
      if (alive.current && request === sequence.current) setState(next);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败。'); }
    finally { mutating.current = false; if (alive.current) setSending(false); }
  }
  const human = state?.players.find(player => player.id === 'human');
  const iris = state?.players.find(player => player.id === 'iris');
  const active = state?.actingPlayer === 'human' && !state.runtime.busy && !sending;
  const betweenHands = state?.street === 'idle' || state?.street === 'complete';
  const outOfChips = state?.players.some(player => player.stack < state.bigBlind);
  const canDeal = !!state && betweenHands && !state.runtime.busy && !sending && !outOfChips;
  const action = (value: Action) => command('action', { action: value });
  return <div className={'rm-app' + (embedded ? ' rm-embedded' : '')}>
    <header className="rm-header">
      <div className="rm-brand"><span className="rm-logo">R<span>♦</span></span><div><strong>RiverMind</strong><span>德扑训练场 · POKER AGENT LAB</span></div></div>
      <div className="rm-header-meta"><span className="rm-live-dot" />{embedded ? 'DSH 插件已连接' : '本地预览 · 规则陪练'}</div>
    </header>
    <section className="rm-intro">
      <div><div className="rm-eyebrow">PLAY. REMEMBER. REVIEW.</div><h1>每一手牌，都有迹可循。</h1><p>与 Iris 对局，观察它如何决策，以及它记住了什么。</p></div>
      <button className="rm-button rm-primary rm-deal" disabled={!canDeal} onClick={() => command('deal')}>
        <span>♣</span>{state?.handNumber ? '发下一手牌' : '开始第一手'}
      </button>
    </section>
    {error && <div className="rm-notice rm-error" role="alert">{error}</div>}
    {state?.runtime.issue && <div className="rm-notice rm-notice-diagnostic" role="status"><p>{state.runtime.issue}</p>
      {state.runtime.lastFallback?.hand.handId === state.handId && <TraceExport report={state.runtime.lastFallback} />}
    </div>}
    <div className="rm-layout">
      <main className="rm-play-area">
        <div className="rm-table-toolbar">
          <div><span className="rm-status-pill">{state ? STREET_NAMES[state.street] : '连接中'}</span><span className="rm-muted">双人无限注训练桌</span></div>
          <div className="rm-table-spec"><span>手牌 <b>{String(state?.handNumber ?? 0).padStart(2, '0')}</b></span><span>盲注 <b>{state?.smallBlind ?? 10} / {state?.bigBlind ?? 20}</b></span></div>
        </div>
        <div className="rm-table-scene">
          <div className="rm-felt"><div className="rm-felt-line" /><span className="rm-felt-wordmark">RIVER MIND</span></div>
          <div className={'rm-seat rm-seat-top' + (state?.actingPlayer === 'iris' ? ' rm-seat-active' : '')}>
            <div className="rm-avatar rm-iris-avatar">I</div>
            <div className="rm-seat-info"><strong>Iris <span className="rm-seat-tag">稳健进攻</span></strong><span>筹码 <b>{iris?.stack ?? 2000}</b></span></div>
            {iris?.dealer && <span className="rm-dealer" title="庄位">D</span>}
            <div className="rm-hole-cards">{(iris?.cards.length ? iris.cards : [null, null]).map((card, i) => <Card value={card} small key={i} />)}</div>
            {iris?.folded && <span className="rm-fold-label">已弃牌</span>}
          </div>
          <div className="rm-board-area">
            {state?.street !== 'idle' && <div className="rm-wagers"><span>Iris 本轮 <b>{iris?.streetBet ?? 0}</b></span><span>你本轮 <b>{human?.streetBet ?? 0}</b></span></div>}
            <div className="rm-pot"><span className="rm-chip">♦</span><span>底池</span><strong>{state?.pot ?? 0}</strong></div>
            <div className="rm-community-cards">{Array.from({ length: 5 }, (_, i) => <Card key={i} value={state?.board[i] ?? null} empty />)}</div>
            <div className="rm-round-message">
              {state?.runtime.busy ? <ThinkingStatus runtime={state.runtime} />
                : state?.result ? state.result.winners.length > 1 ? '平分底池 · 你 ' + signed(state.result.net.human) :
                  (state.result.winners[0] === 'human' ? '你赢下了这一手' : 'Iris 赢下了这一手') + ' · 你 ' + signed(state.result.net.human) +
                  (state.result.handName ? ' · ' + state.result.handName : '')
                : active ? '轮到你行动' : state?.street === 'idle' ? '准备好后，开始第一手牌' : '等待行动'}
            </div>
          </div>
          <div className={'rm-seat rm-seat-bottom' + (active ? ' rm-seat-active' : '')}>
            <div className="rm-avatar rm-human-avatar">你</div>
            <div className="rm-seat-info"><strong>你 <span className="rm-seat-tag">人类玩家</span></strong><span>筹码 <b>{human?.stack ?? 2000}</b></span></div>
            {human?.dealer && <span className="rm-dealer" title="庄位">D</span>}
            <div className="rm-hole-cards">{(human?.cards.length ? human.cards : [null, null]).map((card, i) => <Card value={card} small key={i} />)}</div>
            {human?.folded && <span className="rm-fold-label">已弃牌</span>}
          </div>
        </div>
        <BetControls view={state} enabled={!!active} onAction={action} />
        <div className="rm-bottom-note"><span>底牌按玩家隔离 · 行动由规则引擎校验</span>
          <button className="rm-link" disabled={!betweenHands || sending || state?.runtime.busy} onClick={() => command('reset')}>重新开始训练</button></div>
      </main>
      <aside className="rm-sidebar">
        <section className="rm-opponent-card"><div className="rm-eyebrow">YOUR OPPONENT</div><div className="rm-opponent-title"><span className="rm-avatar rm-iris-avatar">I</span><div><h2>Iris</h2><span>耐心观察，凭证据行动</span></div><span className="rm-memory-badge">有记忆</span></div>
          <p>稳健进攻型陪练。统计公开行为，在有样本支持时调整策略。</p>
          <div className="rm-mode-heading"><label className="rm-mode-label" htmlFor="rm-mode">对手运行模式</label><ModelHelp /></div>
          <select id="rm-mode" value={state?.runtime.mode ?? 'baseline'} disabled={!state || !betweenHands || sending || state.runtime.busy}
            onChange={event => command('mode', { mode: event.target.value })}>
            <option value="baseline">规则陪练 · 不调用模型</option>
            <option value="dsh" disabled={!state?.runtime.dshAvailable}>DSH Agent · 调用已配置模型</option>
          </select>
          <div className="rm-mode-note">{state?.runtime.mode === 'dsh' ? '独立会话 · 4 个扑克工具 · ' + state.runtime.budget.timeoutSeconds + ' 秒行动预算' : '基于牌力抽样和公开统计的固定策略'}</div>
          <IrisSettings state={state} sending={sending} onSave={budget => { void command('settings', { budget }); }} />
        </section>
        <section className="rm-inspector"><div className="rm-tabs">
          <button className={tab === 'events' ? 'rm-tab-active' : ''} onClick={() => setTab('events')}>行动记录</button>
          <button className={tab === 'memory' ? 'rm-tab-active' : ''} onClick={() => setTab('memory')}>玩家记忆</button>
          <button className={tab === 'review' ? 'rm-tab-active' : ''} onClick={() => setTab('review')}>历史复盘</button>
        </div>
        <div className="rm-inspector-body">
          {tab === 'events' && (state?.events.length ? <ol className="rm-event-list">{state.events.map(event => <li key={event.id}>
            <span className={'rm-event-dot' + (event.playerId === 'iris' ? ' rm-event-iris' : '')} />
            <div><small>{STREET_NAMES[event.street]}{event.source ? ' · ' + SOURCE_NAMES[event.source] : ''}</small><p>{event.message}</p></div>
          </li>)}</ol> : <div className="rm-empty"><span>♠</span><strong>第一手故事，还没开始。</strong><p>发牌后，公开行动会依次记录在这里。</p></div>)}
          {tab === 'memory' && <div className="rm-memory-panel"><div className="rm-memory-metrics"><div><strong>{state?.memory.handsObserved ?? 0}</strong><span>观察手数</span></div><div><strong>{state?.memory.handsFolded ?? 0}</strong><span>对手弃牌</span></div><div><strong>{state?.memory.aggressiveHands ?? 0}</strong><span>对手进攻</span></div></div>
            <div className="rm-memory-entry"><div className="rm-entry-heading"><span className="rm-entry-label">IRIS 对你的公开行为记忆</span>{state && <TraceExport label="记忆快照" report={memoryDiagnostics(state.memory)} />}</div><p>{state?.memory.summary ?? '尚无样本。'}</p>
              <small>仅使用公开行动；完成一手牌后更新。</small></div>
            <div className="rm-memory-entry"><span className="rm-entry-label">证据</span>{state?.memory.evidenceHandIds.length ? state.memory.evidenceHandIds.map(id => <MemoryEvidence api={api} key={id} handId={id} onSelect={openEvidence} />) : <p>暂无历史手牌。样本累积后再判断风格。</p>}</div>
            {state?.memory.conditions.map(condition => <div className="rm-memory-entry" key={condition.key}>
              <div className="rm-entry-heading"><span className="rm-entry-label">{STREET_NAMES[condition.street]} · {condition.position === 'button' ? '庄位' : '大盲位'} · {{small:'小',medium:'中',large:'大'}[condition.betSize]}尺度下注</span><TraceExport label="条件记忆" report={memoryDiagnostics(state.memory, condition)} /></div>
              <p>面对主动下注：弃牌 {condition.folds} / {condition.opportunities} 次（{Math.round(condition.foldRate * 100)}%）</p>
              <small>约 95% 区间 {Math.round(condition.foldRateInterval[0]*100)}%～{Math.round(condition.foldRateInterval[1]*100)}% · {condition.usable ? '达到最低样本量' : '样本不足，暂不调整策略'}</small>
              {condition.evidenceHandIds.map(id => <MemoryEvidence api={api} key={id} handId={id} onSelect={openEvidence} compact />)}
            </div>)}
            <p className="rm-fine-print">玩家记忆保存在本地，重新开始训练也会保留。统计记忆尚不代表经过验证的策略学习。</p>
          </div>}
          {tab === 'review' && <ReviewPanel api={api} current={state} handId={reviewHandId} onSelect={setReviewHandId} />}
        </div></section>
      </aside>
    </div>
    <footer className="rm-footer"><span>RIVERMIND <b>03</b> / HEADS-UP TRAINING</span><span>长期记忆 · 独立 Agent · 可追溯决策</span></footer>
  </div>;
}
