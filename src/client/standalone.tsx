import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { apiFromRpc } from './api.js';
import styles from './styles.css';

const tag = document.createElement('style'); tag.textContent = styles; document.head.appendChild(tag);
const api = apiFromRpc(async (endpoint, payload) => {
  const rpcId = crypto.randomUUID();
  const response = await fetch('/rivermind/' + endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }) });
  if (!response.ok) throw new Error('牌桌连接失败：HTTP ' + response.status);
  const envelope = await response.json();
  if (envelope.rpcId !== rpcId) throw new Error('响应关联错误。');
  return envelope.result;
});
createRoot(document.getElementById('root')!).render(<App api={api} />);
