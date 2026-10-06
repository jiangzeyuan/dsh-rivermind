import { useEffect, useState } from 'react';
import type { Action, GameView } from '../core/types.js';
import { betPresets, formatBet, parseBet, type BetPreset, type BetUnit } from './betSizing.js';

export function BetControls({ view, enabled, onAction }: { view: GameView | null; enabled: boolean; onAction(action: Action): void }) {
  const [entry, setEntry] = useState<{ unit: BetUnit; text: string }>({ unit: 'bb', text: '2' });
  const bounds = view?.legal.raise ?? null;
  const bigBlind = view?.bigBlind ?? 20;
  useEffect(() => {
    if (bounds) setEntry(previous => ({ ...previous, text: formatBet(bounds.min, bigBlind, previous.unit) }));
  }, [view?.revision, bounds?.min, bigBlind]);
  const parsed = parseBet(entry.text, entry.unit, bigBlind, bounds);
  const presets = view ? betPresets(view) : { blinds: [], pot: [] };
  const postflop = presets.pot.length > 0;
  const quickAmounts = postflop ? [...presets.pot, ...presets.blinds.filter(preset => preset.key === 'all-in'),
    ...presets.blinds.filter(preset => preset.key !== 'all-in')] : presets.blinds;
  const choose = (amount: number) => setEntry(previous => ({ ...previous, text: formatBet(amount, bigBlind, previous.unit) }));
  const canSize = enabled && !!bounds;
  const hasBet = view?.players.some(player => player.streetBet > 0);
  const verb = hasBet ? '加注至' : '下注至';
  const call = view?.legal.call ?? null;
  const buttons = (items: BetPreset[]) => items.map(preset => <button key={preset.key} type="button"
    className="rm-bet-preset" disabled={!preset.available} title={preset.description}
    aria-pressed={parsed.amount === preset.amount && preset.available}
    onClick={() => choose(preset.amount)}>{preset.label}</button>);
  return <div className="rm-actions">
    <div className="rm-action-heading"><span>{enabled ? '选择你的行动' : view?.street === 'complete' ? '本手已结束' : !view || view.street === 'idle' ? '等待发牌' : '等待对手行动'}</span>
      {canSize && <small title="金额为本轮累计投入，包含已下注筹码；快捷按钮选金额，确认后才下注。">下注至 = 本轮累计投入</small>}</div>
    <div className="rm-action-buttons">
      <button className="rm-button rm-fold" disabled={!enabled || !view?.legal.fold} onClick={() => onAction({ type: 'fold' })}>弃牌</button>
      <button className="rm-button" disabled={!enabled || !view?.legal.check} onClick={() => onAction({ type: 'check' })}>过牌</button>
      <button className="rm-button" disabled={!enabled || call === null} onClick={() => onAction({ type: 'call' })}>
        {enabled && call !== null ? <>跟注 {formatBet(call, bigBlind, 'bb')} BB<small>{call} 筹码</small></> : '跟注'}</button>
      <button className="rm-button rm-primary" disabled={!canSize || parsed.amount === null}
        onClick={() => parsed.amount !== null && onAction({ type: 'raise', amount: parsed.amount })}>
        {canSize && parsed.amount !== null ? <>{verb} {formatBet(parsed.amount, bigBlind, 'bb')} BB<small>{parsed.amount} 筹码</small></> : canSize ? '请输入有效金额' : hasBet ? '加注' : '下注'}</button>
    </div>
    {canSize && <>
      <div className="rm-bet-compact">
        <div className="rm-bet-presets" role="group" aria-label="快捷下注金额">{buttons(quickAmounts)}</div>
        <div className="rm-bet-entry"><label className="rm-visually-hidden" htmlFor="rm-bet-amount">本轮下注至</label>
          <input id="rm-bet-amount" type="number" inputMode="decimal" className="rm-amount-input"
            min={Number(formatBet(bounds.min, bigBlind, entry.unit))} max={Number(formatBet(bounds.max, bigBlind, entry.unit))}
            step={entry.unit === 'bb' ? 0.5 : 1} value={entry.text}
            aria-invalid={!!parsed.error} aria-describedby="rm-bet-help"
            onChange={event => setEntry(previous => ({ ...previous, text: event.target.value }))} />
          <select aria-label="下注金额单位" value={entry.unit} onChange={event => {
            const unit = event.target.value as BetUnit;
            setEntry({ unit, text: formatBet(parsed.amount ?? bounds.min, bigBlind, unit) });
          }}><option value="bb">BB</option><option value="chips">筹码</option></select>
        </div>
      </div>
      <div className="rm-bet-extra-row">
        <span id="rm-bet-help" className={'rm-bet-help' + (parsed.error ? ' rm-bet-invalid' : '')} role={parsed.error ? 'alert' : undefined}>
          {parsed.error ?? (postflop ? '底池比例：跟注后再加注；点击上方确认。' : '快捷按钮选金额，点击上方确认。')}</span>
        <details className="rm-bet-more"><summary>滑动选额</summary>
          <div className="rm-bet-more-body">
            <label className="rm-bet-slider">滑动选择筹码 · {bounds.min}～{bounds.max}
              <input aria-label="滑动选择下注筹码" type="range" min={bounds.min} max={bounds.max} step={1}
                value={parsed.amount ?? bounds.min} onChange={event => choose(Number(event.target.value))} /></label>
          </div>
        </details>
      </div>
    </>}
  </div>;
}
