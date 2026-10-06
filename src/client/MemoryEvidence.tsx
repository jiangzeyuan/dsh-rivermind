import type { PokerApi } from './api.js';
import { TraceExport } from './TraceExport.js';
import { handDiagnostics } from '../core/diagnostics.js';

export function MemoryEvidence({ api, handId, onSelect, compact = false }: {
  api: PokerApi; handId: string; onSelect(id: string): void; compact?: boolean;
}) {
  const handNumber = handId.split(':').at(-1);
  return <div className="rm-memory-evidence-row">
    <button className="rm-link" onClick={() => onSelect(handId)}>{compact ? '第 ' + handNumber + ' 手证据 ↗' : handId.slice(0, 8) + '… · 第 ' + handNumber + ' 手 ↗'}</button>
    <TraceExport label={'第 ' + handNumber + ' 手决策 Trace'} load={async () => handDiagnostics((await api('review', { handId })).view)} />
  </div>;
}
