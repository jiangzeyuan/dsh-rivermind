import { useEffect, useRef, useState } from 'react';
import type { Action, Card as CardValue } from '../core/types.js';
import type { TableSnapshot } from '../host/service.js';
import type { PokerApi } from './api.js';

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
  const [amount, setAmount] = useState(40);
  const [tab, setTab] = useState<'events' | 'memory' | 'review'>('events');
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
  useEffect(() => { if (state?.legal.raise) setAmount(state.legal.raise.min); }, [state?.revision, state?.legal.raise?.min]);
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
  const decisions = state?.street === 'complete' ? state.events.filter(event => event.playerId === 'iris' && event.kind === 'action') : [];
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
    {state?.runtime.issue && <div className="rm-notice" role="status">{state.runtime.issue}</div>}
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
            <div className="rm-pot"><span className="rm-chip">♦</span><span>底池</span><strong>{state?.pot ?? 0}</strong></div>
            <div className="rm-community-cards">{Array.from({ length: 5 }, (_, i) => <Card key={i} value={state?.board[i] ?? null} empty />)}</div>
            <div className="rm-round-message">
              {state?.runtime.busy ? <><span className="rm-thinking" />Iris 正在{state.runtime.mode === 'dsh' ? '通过 DSH 决策' : '计算行动'}…</>
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
          {state?.street !== 'idle' && <div className="rm-wagers"><span>Iris 本轮 <b>{iris?.streetBet ?? 0}</b></span><span>你本轮 <b>{human?.streetBet ?? 0}</b></span></div>}
        </div>
        <div className="rm-actions">
          <div className="rm-action-heading"><span>{active ? '选择你的行动' : betweenHands ? '手牌间设置' : '等待对手行动'}</span><small>加注金额表示本轮累计下注</small></div>
          <div className="rm-action-buttons">
            <button className="rm-button rm-fold" disabled={!active || !state?.legal.fold} onClick={() => action({ type: 'fold' })}>弃牌</button>
            <button className="rm-button" disabled={!active || !state?.legal.check} onClick={() => action({ type: 'check' })}>过牌</button>
            <button className="rm-button" disabled={!active || state?.legal.call === null} onClick={() => action({ type: 'call' })}>跟注{state?.legal.call ? ' ' + state.legal.call : ''}</button>
            <button className="rm-button rm-primary" disabled={!active || !state?.legal.raise} onClick={() => action({ type: 'raise', amount })}>加注至 {amount}</button>
          </div>
          <div className="rm-raise-control"><label htmlFor="rm-bet">下注金额</label>
            <input id="rm-bet" type="range" min={state?.legal.raise?.min ?? 0} max={state?.legal.raise?.max ?? 1}
              value={state?.legal.raise ? amount : 0} disabled={!active || !state?.legal.raise} onChange={event => setAmount(Number(event.target.value))} />
            <input aria-label="加注至的筹码数" className="rm-amount-input" type="number" min={state?.legal.raise?.min ?? 0}
              max={state?.legal.raise?.max ?? 1} value={amount} disabled={!active || !state?.legal.raise}
              onChange={event => setAmount(Math.max(state?.legal.raise?.min ?? 0, Math.min(state?.legal.raise?.max ?? 0, Number(event.target.value))))} />
          </div>
        </div>
        <div className="rm-bottom-note"><span>底牌按玩家隔离 · 行动由规则引擎校验</span>
          <button className="rm-link" disabled={!betweenHands || sending || state?.runtime.busy} onClick={() => command('reset')}>重新开始训练</button></div>
      </main>
      <aside className="rm-sidebar">
        <section className="rm-opponent-card"><div className="rm-eyebrow">YOUR OPPONENT</div><div className="rm-opponent-title"><span className="rm-avatar rm-iris-avatar">I</span><div><h2>Iris</h2><span>耐心观察，凭证据行动</span></div><span className="rm-memory-badge">有记忆</span></div>
          <p>稳健进攻型陪练。统计公开行为，在有样本支持时调整策略。</p>
          <label className="rm-mode-label" htmlFor="rm-mode">对手运行模式</label>
          <select id="rm-mode" value={state?.runtime.mode ?? 'baseline'} disabled={!state || !betweenHands || sending || state.runtime.busy}
            onChange={event => command('mode', { mode: event.target.value })}>
            <option value="baseline">规则陪练 · 不调用模型</option>
            <option value="dsh" disabled={!state?.runtime.dshAvailable}>DSH Agent · 调用已配置模型</option>
          </select>
          <div className="rm-mode-note">{state?.runtime.mode === 'dsh' ? '独立会话 · 4 个扑克工具 · 25 秒行动预算' : '基于牌力抽样和公开统计的固定策略'}</div>
        </section>
        <section className="rm-inspector"><div className="rm-tabs">
          <button className={tab === 'events' ? 'rm-tab-active' : ''} onClick={() => setTab('events')}>行动记录</button>
          <button className={tab === 'memory' ? 'rm-tab-active' : ''} onClick={() => setTab('memory')}>玩家记忆</button>
          <button className={tab === 'review' ? 'rm-tab-active' : ''} onClick={() => setTab('review')}>决策复盘</button>
        </div>
        <div className="rm-inspector-body">
          {tab === 'events' && (state?.events.length ? <ol className="rm-event-list">{state.events.map(event => <li key={event.id}>
            <span className={'rm-event-dot' + (event.playerId === 'iris' ? ' rm-event-iris' : '')} />
            <div><small>{STREET_NAMES[event.street]}{event.source ? ' · ' + SOURCE_NAMES[event.source] : ''}</small><p>{event.message}</p></div>
          </li>)}</ol> : <div className="rm-empty"><span>♠</span><strong>第一手故事，还没开始。</strong><p>发牌后，公开行动会依次记录在这里。</p></div>)}
          {tab === 'memory' && <div className="rm-memory-panel"><div className="rm-memory-metrics"><div><strong>{state?.memory.handsObserved ?? 0}</strong><span>观察手数</span></div><div><strong>{state?.memory.handsFolded ?? 0}</strong><span>对手弃牌</span></div><div><strong>{state?.memory.aggressiveHands ?? 0}</strong><span>对手进攻</span></div></div>
            <div className="rm-memory-entry"><span className="rm-entry-label">IRIS 对你的公开行为记忆</span><p>{state?.memory.summary ?? '尚无样本。'}</p>
              <small>仅使用公开行动；完成一手牌后更新。</small></div>
            <div className="rm-memory-entry"><span className="rm-entry-label">证据</span>{state?.memory.evidenceHandIds.length ? state.memory.evidenceHandIds.map(id => <code key={id}>{id.slice(0, 8) + '… · 第 ' + id.split(':').at(-1) + ' 手'}</code>) : <p>暂无历史手牌。样本累积后再判断风格。</p>}</div>
            <p className="rm-fine-print">玩家记忆保存在本地，重新开始训练也会保留。统计记忆尚不代表经过验证的策略学习。</p>
          </div>}
          {tab === 'review' && (state?.street === 'complete' ? <div className="rm-review-list">
            <p className="rm-fine-print">以下为决策时提交的简短理由。胜率抽样假设随机对手范围，不能作为最优策略证明。</p>
            {decisions.length ? decisions.map(event => <article className="rm-review-item" key={event.id}><div><span className="rm-status-pill">{STREET_NAMES[event.street]}</span><small>{SOURCE_NAMES[event.source ?? 'baseline']}</small></div><h3>{event.message}</h3><p>{event.reason}</p>
              {event.memoryIds?.length ? <small className="rm-evidence-ref">记忆引用：{event.memoryIds.join(', ')}</small> : <small className="rm-evidence-ref">本次未引用长期记忆</small>}</article>) : <p className="rm-fine-print">本手在 Iris 行动前结束，因此没有 AI 决策记录。</p>}
          </div> : <div className="rm-empty"><span>◈</span><strong>先打完，再看决策。</strong><p>手牌结束后开放复盘，避免对局中暴露对手策略。</p></div>)}
        </div></section>
      </aside>
    </div>
    <footer className="rm-footer"><span>RIVERMIND <b>01</b> / HEADS-UP FOUNDATION</span><span>长期记忆 · 独立 Agent · 可追溯决策</span></footer>
  </div>;
}
