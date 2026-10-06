import { useEffect, useState } from 'react';
import { BUDGET_LIMITS, DEFAULT_AGENT_BUDGET, type AgentBudget } from '../core/budget.js';
import type { TableSnapshot } from '../host/service.js';

const PRESETS = [
  { id: 'quick', label: '快速 · 25 秒 / 6 次', timeoutSeconds: 25, maxToolCalls: 6 },
  { id: 'standard', label: '标准 · 60 秒 / 10 次', ...DEFAULT_AGENT_BUDGET },
  { id: 'deep', label: '深入 · 120 秒 / 16 次', timeoutSeconds: 120, maxToolCalls: 16 },
];
export function IrisSettings({ state, sending, onSave }: { state: TableSnapshot | null; sending: boolean; onSave(budget: AgentBudget): void }) {
  const budget = state?.runtime.budget ?? DEFAULT_AGENT_BUDGET;
  const [seconds, setSeconds] = useState(String(budget.timeoutSeconds));
  const [calls, setCalls] = useState(String(budget.maxToolCalls));
  useEffect(() => { setSeconds(String(budget.timeoutSeconds)); setCalls(String(budget.maxToolCalls)); }, [budget.timeoutSeconds, budget.maxToolCalls]);
  const draft = { timeoutSeconds: Number(seconds), maxToolCalls: Number(calls) };
  const valid = seconds.trim() !== '' && calls.trim() !== '' && Object.entries(BUDGET_LIMITS).every(([key, limits]) => {
    const n = draft[key as keyof AgentBudget]; return Number.isSafeInteger(n) && n >= limits.min && n <= limits.max;
  });
  const changed = draft.timeoutSeconds !== budget.timeoutSeconds || draft.maxToolCalls !== budget.maxToolCalls;
  const editable = !!state && !sending && !state.runtime.busy && (state.street === 'idle' || state.street === 'complete');
  const preset = PRESETS.find(p => p.timeoutSeconds === draft.timeoutSeconds && p.maxToolCalls === draft.maxToolCalls)?.id ?? 'custom';
  return <details className="rm-budget-settings">
    <summary><span>Iris 决策预算</span><small>{budget.timeoutSeconds} 秒 / {budget.maxToolCalls} 次</small></summary>
    <div className="rm-budget-body"><p className="rm-fine-print">当前：{budget.timeoutSeconds} 秒 · {budget.maxToolCalls} 次工具调用</p>
    <label className="rm-mode-label" htmlFor="rm-budget-preset">预算预设</label>
    <select id="rm-budget-preset" value={preset} disabled={!editable} onChange={event => {
      const p = PRESETS.find(p => p.id === event.target.value);
      if (p) { setSeconds(String(p.timeoutSeconds)); setCalls(String(p.maxToolCalls)); }
    }}><option value="custom" disabled>自定义</option>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
    <div className="rm-budget-fields">
      <label htmlFor="rm-budget-seconds">思考时限（秒）<input id="rm-budget-seconds" type="number" min={5} max={300} step={1}
        value={seconds} disabled={!editable} onChange={event => setSeconds(event.target.value)} /></label>
      <label htmlFor="rm-budget-calls">工具上限（次）<input id="rm-budget-calls" type="number" min={1} max={32} step={1}
        value={calls} disabled={!editable} onChange={event => setCalls(event.target.value)} /></label>
    </div>
    {!valid && <p className="rm-bet-help rm-bet-invalid" role="alert">时限为 5～300 秒、工具为 1～32 次，均须为整数。</p>}
    <button className="rm-button rm-budget-save" disabled={!editable || !valid || !changed} onClick={() => onSave(draft)}>保存 Iris 预算</button>
    <p className="rm-fine-print">{!editable ? '请在两手牌之间修改。' : changed ? '修改后请保存，下一次决策生效。' : '已保存的预算会在重启后保留。'}
      {state?.runtime.mode === 'baseline' ? ' 规则陪练不使用此预算。' : ' 时限覆盖完整行动，工具次数包含最终提交；增加预算可能增加等待和模型用量。'}</p>
    </div>
  </details>;
}

export function ThinkingStatus({ runtime }: { runtime: TableSnapshot['runtime'] }) {
  const [now, setNow] = useState(Date.now());
  const startedAt = runtime.thinking?.startedAt;
  useEffect(() => {
    setNow(Date.now());
    if (!runtime.busy || !startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runtime.busy, startedAt]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return <><span className="rm-thinking" />{runtime.mode === 'dsh' ? 'Iris 正在思考 · ' + elapsed + ' / ' +
    (runtime.thinking?.budget.timeoutSeconds ?? runtime.budget.timeoutSeconds) + ' 秒' : 'Iris 正在计算行动…'}</>;
}
