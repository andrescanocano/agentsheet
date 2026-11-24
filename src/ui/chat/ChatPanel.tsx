// Panel del agente: chat con streaming, pasos de herramientas, aprobaciones, deshacer y sugerencias.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as S from '../../core/store';
import { connect, send, onEvent, onStatus, isPages, type ServerEvent } from '../../agent/client';
import { buildContext } from '../../agent/ops';
import './chat.css';

type Item =
  | { kind: 'text'; text: string }
  | { kind: 'step'; id: string; label: string; status: string; detail?: string }
  | { kind: 'approve'; reqId: string; label: string; status: 'pending' | 'yes' | 'no' };
interface Msg { role: 'user' | 'assistant'; text?: string; items: Item[]; error?: string; undoable?: boolean }
interface Sug { titulo: string; prompt: string }

const STARTERS: Sug[] = [
  { titulo: 'Tabla de ventas de ejemplo', prompt: 'Crea una tabla de ventas de ejemplo de 20 productos por región con totales y un resumen' },
  { titulo: 'Cruzar precios por URL', prompt: 'Trae los datos de /demo/precios.csv y crúzalos con la tabla usando BUSCARV para traer el costo unitario y calcular el margen' },
  { titulo: 'Presupuesto mensual', prompt: 'Crea un presupuesto mensual de gastos de una oficina en pesos colombianos, con IVA del 19 % calculado con fórmulas y un gráfico de torta' },
];
const MODELS = [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (rápido)' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }];
const TX_PREFIX = 'Agente: ';

function inline(s: string, k: string): ReactNode[] {
  const out: ReactNode[] = []; const re = /(\*\*[^*]+\*\*|`[^`]+`)/g; let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0]; out.push(t.startsWith('**') ? <strong key={k + i++}>{t.slice(2, -2)}</strong> : <code key={k + i++}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []; const lines = text.split('\n'); let list: ReactNode[] = []; let code: string[] | null = null;
  let table: string[][] = [];
  const flushT = () => { if (table.length) { const [h, ...rows] = table; blocks.push(<table key={'t' + blocks.length} className="md-t"><thead><tr>{h.map((c, k) => <th key={k}>{inline(c, 'th' + k)}</th>)}</tr></thead><tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, k) => <td key={k}>{inline(c, 'td' + a + k)}</td>)}</tr>)}</tbody></table>); table = []; } };
  const flush = () => { flushT(); if (list.length) { blocks.push(<ul key={'u' + blocks.length}>{list}</ul>); list = []; } };
  lines.forEach((ln, i) => {
    if (ln.trim().startsWith('```')) { if (code) { blocks.push(<pre key={'c' + i}>{code.join('\n')}</pre>); code = null; } else { flush(); code = []; } return; }
    if (code) { code.push(ln); return; }
    if (/^\s*\|.*\|\s*$/.test(ln)) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(ln)) table.push(ln.trim().slice(1, -1).split('|').map(x => x.trim())); return; }
    flushT();
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(ln);
    if (li) { list.push(<li key={i}>{inline(li[1], 'l' + i)}</li>); return; }
    flush();
    const h = /^#{1,4}\s+(.*)$/.exec(ln);
    if (h) blocks.push(<p key={i} className="md-h">{inline(h[1], 'h' + i)}</p>);
    else if (ln.trim()) blocks.push(<p key={i}>{inline(ln, 'p' + i)}</p>);
  });
  flush(); if (code) blocks.push(<pre key="cend">{(code as string[]).join('\n')}</pre>);
  return <div className="md">{blocks}</div>;
}

export function ChatPanel() {
  const pages = isPages();
  useSyncExternalStore(S.subscribe, S.getVersion); // re-render al cambiar el libro (chips de arranque)
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [mode, setMode] = useState<'auto' | 'ask'>('auto');
  const [model, setModel] = useState(MODELS[0].id);
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [open, setOpen] = useState(false); // solo en pantallas pequeñas
  const sessionRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const txOpen = useRef(false);
  const txLabel = useRef(''); const lastAgentTx = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const sugVersion = useRef(-1);

  const patchLast = (f: (m: Msg) => Msg) => setMsgs(ms => { const c = ms.slice(); const i = c.length - 1; if (i >= 0 && c[i].role === 'assistant') c[i] = f(c[i]); return c; });

  const finish = () => {
    if (txOpen.current) { try { S.commitTransaction(); } catch { /* */ } txOpen.current = false; }
    busyRef.current = false; setBusy(false);
    let canUndoAgent = false; try { canUndoAgent = S.undoLabel() === txLabel.current; } catch { /* */ }
    if (canUndoAgent) lastAgentTx.current = txLabel.current;
    patchLast(m => ({ ...m, undoable: canUndoAgent }));
  };

  useEffect(() => {
    if (pages) return;
    connect();
    const offS = onStatus(setOnline);
    const offE = onEvent((e: ServerEvent) => {
      switch (e.type) {
        case 'session': sessionRef.current = e.sessionId; break;
        case 'text': patchLast(m => { const items = m.items.slice(); const l = items[items.length - 1]; if (l?.kind === 'text') items[items.length - 1] = { kind: 'text', text: l.text + e.delta }; else items.push({ kind: 'text', text: e.delta }); return { ...m, items }; }); break;
        case 'text_break': patchLast(m => { const l = m.items[m.items.length - 1]; return l?.kind === 'text' && l.text ? { ...m, items: [...m.items, { kind: 'text', text: '' }] } : m; }); break;
        case 'tool': patchLast(m => {
          const items = m.items.slice(); const i = items.findIndex(x => x.kind === 'step' && x.id === e.id);
          const st: Item = { kind: 'step', id: e.id, label: e.label, status: e.status, detail: e.detail };
          if (i >= 0) items[i] = st; else items.push(st); return { ...m, items };
        }); break;
        case 'approve_request': patchLast(m => ({ ...m, items: [...m.items, { kind: 'approve', reqId: e.reqId, label: e.summary, status: 'pending' }] })); break;
        case 'error': patchLast(m => ({ ...m, error: e.message })); break;
        case 'done': if (e.sessionId) sessionRef.current = e.sessionId; finish(); break;
      }
    });
    return () => { offS(); offE(); };
  }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs]);

  // Sugerencias proactivas: cuando el libro queda quieto 4 s con datos.
  useEffect(() => {
    if (pages) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (busyRef.current) return;
        let used = null; try { used = S.usedRange(S.getSheet().id); } catch { return; }
        if (!used) { setSugs([]); return; }
        const v = S.getVersion(); if (v === sugVersion.current) return; sugVersion.current = v;
        try {
          const r = await fetch('/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: buildContext() }) });
          const j = await r.json(); if (S.getVersion() === v && Array.isArray(j.suggestions) && j.suggestions.length) setSugs(j.suggestions);
        } catch { /* sin sugerencias */ }
      }, 4000);
    };
    check();
    const off = S.subscribe(check);
    return () => { off(); clearTimeout(timer); };
  }, []);

  const submit = (text: string) => {
    const t = text.trim(); if (!t || busyRef.current || pages) return;
    let context = ''; try { context = buildContext(); } catch { /* store aún no listo */ }
    setMsgs(ms => [...ms.map(m => ({ ...m, undoable: false })), { role: 'user', text: t, items: [] }, { role: 'assistant', items: [] }]);
    if (!send({ type: 'chat', text: t, context, model, mode, sessionId: sessionRef.current })) {
      patchLast(m => ({ ...m, error: 'Sin conexión con el servidor del agente. Reintentando…' })); return;
    }
    try { let lbl = TX_PREFIX + t.slice(0, 40); if (S.undoLabel() === lbl) lbl += ' (2)'; txLabel.current = lbl; S.beginTransaction(lbl); txOpen.current = true; } catch { /* */ }
    busyRef.current = true; setBusy(true); setInput(''); setSugs([]);
  };
  const approve = (reqId: string, ok: boolean) => {
    send({ type: 'approve_response', reqId, ok });
    setMsgs(ms => ms.map(m => ({ ...m, items: m.items.map(it => it.kind === 'approve' && it.reqId === reqId ? { ...it, status: ok ? 'yes' : 'no' } : it) })));
  };
  const undoAll = () => {
    try { if (S.undoLabel() === lastAgentTx.current) S.undo(); } catch { /* */ }
    setMsgs(ms => ms.map(m => ({ ...m, undoable: false })));
    setMsgs(ms => [...ms, { role: 'assistant', items: [{ kind: 'text', text: 'Listo: deshice todo lo que hizo el agente en esa petición.' }] }]);
  };
  const reset = () => { sessionRef.current = undefined; setMsgs([]); };

  let isEmpty = true; try { isEmpty = !S.usedRange(S.getSheet().id); } catch { /* */ }
  const chips = sugs.length ? sugs : (isEmpty ? STARTERS : []);

  return (
    <>
      <aside className={'chat-panel' + (open ? ' open' : '')}>
        <header className="chat-head">
          <div className="chat-title"><span className={'dot ' + (online ? 'on' : 'off')} />Agente</div>
          <div>{!pages && <button className="chat-link" onClick={reset} disabled={busy}>Nueva conversación</button>}<button className="chat-close" onClick={() => setOpen(false)} aria-label="Cerrar agente">×</button></div>
        </header>
        {pages ? <div className="chat-empty">Versión sin agente: corre en local para usar la IA.</div> : <>
          <div className="chat-controls">
            <div className="seg">
              <button className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')} disabled={busy}>Preguntar antes de aplicar</button>
              <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')} disabled={busy}>Autónomo</button>
            </div>
            <select value={model} onChange={e => setModel(e.target.value)} disabled={busy}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </div>
          <div className="chat-list" ref={listRef}>
            {msgs.length === 0 && <div className="chat-empty">Pídeme lo que quieras hacer en la hoja. Trabajo en vivo y puedes deshacer todo de un golpe.</div>}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="bubble user">{m.text}</div>
              : <div key={i} className="bubble bot">
                {m.items.map((it, j) => it.kind === 'text' ? (it.text ? <Markdown key={j} text={it.text} /> : null)
                  : it.kind === 'step' ? <div key={j} className={'step ' + it.status}><span className="ic">{it.status === 'running' ? <span className="spin" /> : it.status === 'done' ? '✓' : it.status === 'rejected' ? '–' : '!'}</span>{it.label}{it.status === 'rejected' ? ' (rechazado)' : ''}{it.detail ? <em> — {it.detail}</em> : null}</div>
                  : <div key={j} className="approve"><div className="approve-t">¿Aplico este paso?</div><div>{it.label}</div>
                    {it.status === 'pending' ? <div className="approve-b"><button className="primary" onClick={() => approve(it.reqId, true)}>Aplicar</button><button onClick={() => approve(it.reqId, false)}>Rechazar</button></div>
                      : <div className="approve-s">{it.status === 'yes' ? 'Aplicado' : 'Rechazado'}</div>}</div>)}
                {busy && i === msgs.length - 1 && !m.items.length && <div className="step running"><span className="ic"><span className="spin" /></span>Pensando…</div>}
                {m.error && <div className="chat-error">{m.error}</div>}
                {m.undoable && <button className="undo-all" onClick={undoAll}>Deshacer todo lo del agente</button>}
              </div>)}
          </div>
          {!busy && chips.length > 0 && <div className="chips">{chips.map((c, i) => <button key={i} title={c.prompt} onClick={() => submit(c.prompt)}>{c.titulo}</button>)}</div>}
          <div className="chat-input">
            <textarea value={input} placeholder={online ? 'Escribe una instrucción… (Enter envía, Shift+Enter salto)' : 'Conectando con el servidor…'} rows={2}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }} />
            {busy ? <button className="stop" onClick={() => send({ type: 'stop' })}>Detener</button>
              : <button className="primary" onClick={() => submit(input)} disabled={!input.trim() || !online}>Enviar</button>}
          </div>
        </>}
      </aside>
      <button className="chat-fab" onClick={() => setOpen(o => !o)} aria-label="Abrir agente">{open ? '×' : 'Agente'}</button>
    </>
  );
}
