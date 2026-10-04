import { useEffect, useState } from 'react';
import type { PokerApi } from './api.js';
import type { TableSnapshot } from '../host/service.js';
import type { HistoryPage, SavedReview } from '../host/reviews.js';
import { replayFrame } from './replay.js';
const STREETS = { idle: '准备开始', preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', complete: '本手结束' };
const SOURCES = { human: '玩家', baseline: '规则陪练', dsh: 'DSH Agent', fallback: '安全兜底' };
function cardLabel(card: string | null): string {
  if (!card) return '■';
  return (card[0] === 'T' ? '10' : card[0]!) + ({s:'♠',h:'♥',d:'♦',c:'♣'} as Record<string,string>)[card[1]!]!;
}
export function ReviewPanel({ api, current, handId, onSelect }: {
  api: PokerApi; current: TableSnapshot | null; handId: string | null; onSelect(id: string | null): void;
}) {
  const [history, setHistory] = useState<HistoryPage>({ hands: [], truncated: false });
  const [review, setReview] = useState<SavedReview | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const target = handId ?? (current?.street === 'complete' ? current.handId : null);
  useEffect(() => {
    let live = true;
    void api('history').then(value => { if (live) setHistory(value); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api, current?.handId, current?.street === 'complete']);
  useEffect(() => {
    let live = true; setReview(null); setError('');
    if (target) void api('review', { handId: target }).then(value => {
      if (live) { setReview(value); setStep(value.view.events.length); }
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api, target]);
  const frame = review ? replayFrame(review.view, step) : null;
  const last = frame?.events.at(-1);
  const decisions = frame?.events.filter(event => event.playerId === 'iris' && event.kind === 'action') ?? [];
  return <div className="rm-review-list">
    <label className="rm-mode-label" htmlFor="rm-history">选择已结束手牌</label>
    <select id="rm-history" value={handId ?? ''} onChange={event => onSelect(event.target.value || null)}>
      <option value="">当前手牌{current?.street === 'complete' ? '' : '（尚未结束）'}</option>
      {history.hands.map(hand => <option key={hand.handId} value={hand.handId}>第 {hand.handNumber} 手 · {hand.handId.slice(0,8)} · 你 {hand.result.net.human >= 0 ? '+' : ''}{hand.result.net.human}</option>)}
    </select>
    {history.truncated && <p className="rm-fine-print">仅列出最近手牌；日志文件保留全部记录。</p>}
    {error && <p role="alert" className="rm-fine-print">{error}</p>}
    {!review ? <div className="rm-empty"><span>◈</span><strong>{target ? '正在读取复盘' : '先打完，再看决策。'}</strong><p>也可以选择历史手牌，查看当时的公开证据。</p></div> : <>
      <div className="rm-memory-entry"><span className="rm-entry-label">逐步回放 · {STREETS[frame!.street]}</span>
        <input className="rm-replay-range" aria-label="回放步骤" type="range" min={0} max={review.view.events.length} value={step} onChange={event => setStep(Number(event.target.value))} />
        <div className="rm-replay-controls"><button className="rm-button" disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</button><button className="rm-button" disabled={step === review.view.events.length} onClick={() => setStep(step + 1)}>下一步</button></div>
        <p>{step} / {review.view.events.length} · {last?.message ?? '发牌前'}</p>
        <p>公共牌：{frame!.board.map(cardLabel).join(' ') || '尚未发出'} · 底池 {frame!.pot}</p>
        {frame!.players.map(player => <p key={player.id}>{player.name}：{player.cards.map(cardLabel).join(' ')} · 筹码 {player.stack}</p>)}
      </div>
      <div className="rm-memory-entry"><span className="rm-entry-label">该手决策时可用的记忆</span><p>{review.memoryBeforeUpdate.summary}</p><small>{review.memoryBeforeUpdate.id}</small></div>
      <p className="rm-fine-print">以下理由和工具记录均在手牌结束后开放。抽样胜率假设随机对手范围，不能证明最优策略。</p>
      {decisions.map(event => <article className="rm-review-item" key={event.id}>
        <div><span className="rm-status-pill">{STREETS[event.street]}</span><small>{SOURCES[event.source ?? 'baseline']}</small></div>
        <h3>{event.message}</h3><p>{event.reason}</p>
        {event.trace && <p className="rm-fine-print">耗时 {Math.round(event.trace.durationMs)} ms{event.trace.failure ? ' · 失败类别 ' + event.trace.failure : ''}
          {event.trace.facts ? ' · 跟注门槛 ' + (event.trace.facts.potOdds * 100).toFixed(1) + '%' : ''}
          {event.trace.equity ? ' · 抽样 ' + event.trace.equity.trials + ' 次' : ''}</p>}
        {event.trace?.tools.length ? <p className="rm-fine-print">工具：{event.trace.tools.map(t => t.name + '（' + t.status + '）').join(' → ')}</p> : null}
        <small className="rm-evidence-ref">{event.memoryIds?.length ? '记忆引用：' + event.memoryIds.join(', ') : '本次未引用长期记忆'}</small>
      </article>)}
      {decisions.length === 0 && <p className="rm-fine-print">此回放步骤之前没有 Iris 决策。</p>}
    </>}
  </div>;
}
