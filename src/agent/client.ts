// Cliente WebSocket del agente: reconexión automática y ejecución de operaciones contra el store.
import { runOp } from './ops';

export type ServerEvent =
  | { type: 'text'; delta: string } | { type: 'text_break' }
  | { type: 'tool'; id: string; label: string; status: 'running' | 'done' | 'error' | 'rejected'; detail?: string }
  | { type: 'approve_request'; reqId: string; summary: string }
  | { type: 'session'; sessionId: string; apiKeySource?: string; model?: string }
  | { type: 'error'; message: string } | { type: 'done'; sessionId?: string };

type Handler = (e: ServerEvent) => void;
const handlers = new Set<Handler>();
const statusHandlers = new Set<(up: boolean) => void>();
let ws: WebSocket | null = null; let up = false; let retry = 0;

export const isPages = (): boolean => { try { return typeof __PAGES__ !== 'undefined' && !!__PAGES__; } catch { return false; } };

function setUp(v: boolean) { up = v; statusHandlers.forEach(h => h(v)); }

export function connect() {
  if (isPages() || ws) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const sock = new WebSocket(url); ws = sock;
  sock.onopen = () => { retry = 0; setUp(true); };
  sock.onclose = () => { ws = null; setUp(false); setTimeout(connect, Math.min(5000, 500 * 2 ** retry++)); };
  sock.onerror = () => { try { sock.close(); } catch { /* */ } };
  sock.onmessage = async ev => {
    let m: any; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'op') { const result = await runOp(m.name, m.args); send({ type: 'op_result', opId: m.opId, result }); return; }
    handlers.forEach(h => h(m));
  };
}

export function send(m: Record<string, unknown>): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; }
  return false;
}
export const onEvent = (h: Handler) => { handlers.add(h); return () => { handlers.delete(h); }; };
export const onStatus = (h: (up: boolean) => void) => { statusHandlers.add(h); h(up); return () => { statusHandlers.delete(h); }; };
