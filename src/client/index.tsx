import { App } from './App.js';
import { apiFromRpc, type RpcResult } from './api.js';
import styles from './styles.css';

export const inject = ['slots', 'layout', 'connection'];
interface ClientContext {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult> } };
  slots: {
    inject(name: string, callback: () => unknown): unknown;
    register(spec: Record<string, unknown>, component: unknown): unknown;
  };
  effect(callback: () => (() => void)): unknown;
}
export function apply(ctx: ClientContext) {
  const api = apiFromRpc((endpoint, payload) => ctx.connection.rpc.call('/api', 'rivermind/' + endpoint, payload));
  const Panel = () => <App api={api} embedded />;
  const Icon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 21 12 12 22 3 12Z" fill="currentColor" /><path d="M12 6 17 12 12 18 7 12Z" fill="none" stroke="currentColor" strokeWidth="1" /></svg>;
  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = '@rivermind/dsh-plugin'; tag.textContent = styles;
    document.head.appendChild(tag);
    return () => tag.remove();
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'rivermind' }, Panel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'rivermind', order: -5, label: () => 'RiverMind 德扑训练场',
  }, Icon));
}
