// Servidor de AgentsSheet: Express (API + /demo) y WebSocket (/ws) para el agente.
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent, suggest, type Bridge } from './agent';

delete process.env.ANTHROPIC_API_KEY; // nunca una llave: el plan de suscripción vía la sesión local de `claude`

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/demo', express.static(path.join(ROOT, 'public/demo')));
app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.post('/api/suggest', async (req, res) => {
  try { res.json({ suggestions: await suggest(String(req.body?.context ?? '')) }); }
  catch (e: any) { res.status(500).json({ error: String(e?.message ?? e), suggestions: [] }); }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  const pendingOps = new Map<string, (v: unknown) => void>();
  const pendingApprovals = new Map<string, (v: boolean) => void>();
  let current: ReturnType<typeof runAgent> | null = null;
  let n = 0; let stopped = false;
  const send = (m: Record<string, unknown>) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

  ws.on('message', async raw => {
    let msg: any; try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'op_result') { pendingOps.get(msg.opId)?.(msg.result); pendingOps.delete(msg.opId); return; }
    if (msg.type === 'approve_response') { pendingApprovals.get(msg.reqId)?.(!!msg.ok); pendingApprovals.delete(msg.reqId); return; }
    if (msg.type === 'stop') { stopped = true; try { await current?.interrupt(); } catch { /* */ } for (const r of pendingApprovals.values()) r(false); pendingApprovals.clear(); return; }
    if (msg.type !== 'chat') return;
    if (current) { send({ type: 'error', message: 'El agente ya está trabajando. Espera o pulsa Detener.' }); return; }

    const bridge: Bridge = {
      mode: msg.mode === 'ask' ? 'ask' : 'auto',
      emit: ev => send(ev),
      op: (name, args) => new Promise((resolve, reject) => {
        const opId = `op${++n}`; pendingOps.set(opId, resolve);
        send({ type: 'op', opId, name, args });
        setTimeout(() => { if (pendingOps.delete(opId)) reject(new Error('El navegador no respondió a tiempo')); }, 30000);
      }),
      approve: summary => new Promise(resolve => {
        const reqId = `ap${++n}`; pendingApprovals.set(reqId, resolve);
        send({ type: 'approve_request', reqId, summary });
      }),
    };
    const prompt = `${msg.context ? `Contexto actual de la hoja (lo manda el navegador):\n${msg.context}\n\n` : ''}Petición del usuario: ${msg.text}`;
    let sessionId: string | undefined = msg.sessionId || undefined;
    stopped = false;
    try {
      current = runAgent({ prompt, model: msg.model || 'claude-sonnet-5-5', resume: sessionId, bridge });
      for await (const m of current) {
        if (m.type === 'system' && m.subtype === 'init') { sessionId = m.session_id; send({ type: 'session', sessionId, apiKeySource: m.apiKeySource, model: m.model }); }
        else if (m.type === 'stream_event') {
          const ev: any = m.event;
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send({ type: 'text', delta: ev.delta.text });
          if (ev.type === 'message_start') send({ type: 'text_break' });
        } else if (m.type === 'result') {
          sessionId = m.session_id;
          if (stopped) { /* detenido por el usuario */ }
          else if (m.subtype !== 'success') send({ type: 'error', message: (m as any).errors?.join?.('; ') || `El agente terminó con ${m.subtype}` });
          else if (m.is_error) send({ type: 'error', message: m.result });
        }
      }
      send({ type: 'done', sessionId });
    } catch (e: any) {
      if (stopped) { send({ type: 'text_break' }); send({ type: 'text', delta: '**Detenido por el usuario.**' }); send({ type: 'done', sessionId }); return; }
      const raw = String(e?.message ?? e);
      const message = /authenticate|not logged in|oauth/i.test(raw) ? `El CLI local de Claude no tiene sesión activa. En la Terminal corre: claude auth login (una vez) y vuelve a intentar. Detalle: ${raw}` : raw;
      send({ type: 'error', message });
      send({ type: 'done', sessionId });
    } finally { current = null; }
  });
  ws.on('close', () => { current?.interrupt().catch(() => {}); for (const r of pendingApprovals.values()) r(false); });
});

const PORT = Number(process.env.PORT ?? 8787);
server.listen(PORT, '0.0.0.0', () => console.log(`AgentsSheet servidor en http://0.0.0.0:${PORT} (ws /ws)`));
