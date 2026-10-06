import { useEffect, useId, useRef, useState } from 'react';
import type { DiagnosticReport } from '../core/diagnostics.js';

type Props = { label?: string } & (
  { report: DiagnosticReport; load?: never } | { report?: never; load(): Promise<DiagnosticReport> }
);

export function TraceExport({ report, load, label = '决策 Trace' }: Props) {
  const [loaded, setLoaded] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'manual'>('idle');
  const activeReport = report ?? loaded;
  const text = activeReport ? JSON.stringify(activeReport, null, 2) : '';
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLTextAreaElement>(null);
  const operation = useRef(0);
  const titleId = useId();
  useEffect(() => {
    operation.current++; setStatus('idle');
    return () => { operation.current++; };
  }, [text]);
  useEffect(() => {
    if (status === 'manual') { output.current?.focus(); output.current?.select(); }
  }, [status]);
  async function open() {
    dialog.current?.showModal();
    setError(''); setStatus('idle');
    if (!load) return;
    setLoading(true);
    const attempt = ++operation.current;
    try {
      const next = await load();
      if (operation.current === attempt) setLoaded(next);
    } catch {
      if (operation.current === attempt) setError('无法读取该手资料。它可能已超出最近复盘窗口，请查看本地历史记录。');
    } finally {
      if (operation.current === attempt) setLoading(false);
    }
  }
  async function copy() {
    const attempt = ++operation.current;
    setStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (operation.current === attempt) setStatus('copied');
    } catch {
      if (operation.current === attempt) setStatus('manual');
    }
  }
  return <span className="rm-trace-export">
    <button type="button" className="rm-trace-trigger" aria-label={'查看并复制' + label} title={'查看并复制' + label}
      aria-haspopup="dialog" onClick={() => void open()}>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3.5h7l3 3v10H6zM13 3.5v3h3M3 13V2h8M8.5 10h5M8.5 13h5" />
      </svg>
    </button>
    <dialog ref={dialog} className="rm-trace-dialog" aria-labelledby={titleId}
      onClose={() => { operation.current++; setLoading(false); }}>
      <div className="rm-trace-dialog-heading"><h3 id={titleId}>{label}</h3>
        <button type="button" className="rm-trace-close" aria-label="关闭资料" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <p className="rm-trace-description">用于排查问题或反馈；资料不会自动上传。</p>
      {loading ? <p role="status">正在读取资料…</p> : error ? <p role="alert">{error}</p> : activeReport && <>
        <div className="rm-trace-actions"><button type="button" className="rm-button rm-trace-copy" disabled={status === 'copying'} onClick={() => void copy()}>
          {status === 'copying' ? '正在复制…' : status === 'copied' ? '已复制' : '复制 JSON'}
        </button><span className="rm-trace-status" role="status">{status === 'copied' ? '已复制，可直接粘贴。'
          : status === 'manual' ? '请按 Ctrl/Cmd+C 复制已选中的资料。' : ''}</span></div>
        <div className="rm-trace-preview">
          {activeReport.schema === 'rivermind.decision-diagnostics/v1' && <>
            <p>{activeReport.scope === 'runtime-only' ? '手牌进行中，仅含运行诊断。' : '包含此决策已保存的业务 Trace。'}不含底牌、凭证、原始模型内容或工具参数。</p>
            {activeReport.coverage.trace === 'not-recorded' && <p>旧记录未保存 Trace，无法补回诊断数据。</p>}
            {activeReport.coverage.model === 'not-recorded' && <p>模型信息未记录。</p>}
            {activeReport.coverage.model === 'selected-only' && <p>仅记录创建时选择，未捕获实际请求模型。</p>}
          </>}
          {activeReport.schema === 'rivermind.hand-diagnostics/v1' && <p>仅含这手牌已保存的 Iris 决策 Trace，不含底牌或原始模型内容。{activeReport.coverage.recorded === 0 ? '此手没有已保存的 Trace。' : ''}</p>}
          {activeReport.schema === 'rivermind.memory-diagnostics/v1' && <p>包含该快照的公开行为统计及证据手牌编号；决策 Trace 可从证据手牌旁的图标查看。</p>}
          <textarea ref={output} aria-label="诊断 Trace JSON" readOnly value={text} rows={12} onFocus={event => event.currentTarget.select()} />
        </div>
      </>}
    </dialog>
  </span>;
}
