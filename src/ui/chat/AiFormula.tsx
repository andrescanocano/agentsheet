// Autocompletar fórmulas con IA: botón ✨ junto a fx y atajo "=?" en una celda.
import { useEffect, useRef, useState } from 'react';
import * as S from '../../core/store';
import { toA1 } from '../../core/a1';
import { buildContext } from '../../agent/ops';
import './chat.css';

type Target = { sheetId: string; r: number; c: number };
type State = { phase: 'ask' | 'loading' | 'preview' | 'error'; target: Target; desc: string; formula?: string; explicacion?: string; error?: string } | null;

function activeTarget(): Target { const s = S.getSelection(); return { sheetId: s.sheetId || S.getSheet().id, r: s.r1, c: s.c1 }; }

export function AiFormulaButton() {
  const [st, setSt] = useState<State>(null);
  const inRef = useRef<HTMLInputElement>(null);
  const pages = typeof __PAGES__ !== 'undefined' && __PAGES__;

  const run = async (target: Target, desc: string) => {
    setSt({ phase: 'loading', target, desc });
    try {
      const sh = S.getWorkbook().sheets.find(x => x.id === target.sheetId);
      const contexto = buildContext() + `\nNombres de hojas: ${S.getWorkbook().sheets.map(x => x.name).join(', ')}. La celda activa está en la hoja ${sh?.name}.`;
      const r = await fetch('/api/formula', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ descripcion: desc, celdaActiva: toA1(target.r, target.c), contexto }) });
      const j = await r.json();
      if (!r.ok || !j.formula) throw new Error(j.error || 'La IA no devolvió una fórmula.');
      setSt({ phase: 'preview', target, desc, formula: j.formula, explicacion: j.explicacion });
    } catch (e: any) { setSt({ phase: 'error', target, desc, error: String(e?.message ?? e) }); }
  };

  // Atajo: una celda que queda con "=? descripción" dispara la IA y se limpia.
  useEffect(() => {
    if (pages) return;
    const check = () => {
      const sel = S.getSelection(); const sid = sel.sheetId || S.getSheet().id;
      for (const [r, c] of [[sel.r1 - 1, sel.c1], [sel.r1, sel.c1 - 1], [sel.r1, sel.c1]]) {
        if (r < 0 || c < 0) continue;
        const inp = S.getInput(sid, r, c);
        if (inp.startsWith('=?')) {
          S.setInputs(sid, [{ r, c, input: '' }]);
          S.setSelection({ sheetId: sid, r1: r, c1: c, r2: r, c2: c });
          void run({ sheetId: sid, r, c }, inp.slice(2).trim());
          return;
        }
      }
    };
    return S.subscribe(check);
  }, []);

  useEffect(() => { if (st?.phase === 'ask') inRef.current?.focus(); }, [st?.phase]);

  const insert = () => {
    if (!st?.formula) return;
    S.setInputs(st.target.sheetId, [{ r: st.target.r, c: st.target.c, input: st.formula }]);
    S.setSelection({ sheetId: st.target.sheetId, r1: st.target.r, c1: st.target.c, r2: st.target.r, c2: st.target.c });
    setSt(null);
  };

  if (pages) return null;
  return (
    <span className="aif">
      <button className="aif-btn" title="Autocompletar fórmula con IA" onClick={() => setSt(s => s ? null : { phase: 'ask', target: activeTarget(), desc: '' })}>✨</button>
      {st && <div className="aif-pop" onKeyDown={e => { if (e.key === 'Escape') setSt(null); }}>
        <div className="aif-title">Fórmula con IA para {toA1(st.target.r, st.target.c)}</div>
        {st.phase === 'ask' && <form onSubmit={e => { e.preventDefault(); if (st.desc.trim()) void run(st.target, st.desc.trim()); }}>
          <input ref={inRef} className="aif-in" placeholder="Describe la fórmula (ej. total de ventas de Bogotá)" value={st.desc} onChange={e => setSt({ ...st, desc: e.target.value })} />
          <div className="aif-b"><button type="submit" className="primary" disabled={!st.desc.trim()}>Generar</button><button type="button" onClick={() => setSt(null)}>Cancelar</button></div>
        </form>}
        {st.phase === 'loading' && <div className="step running"><span className="ic"><span className="spin" /></span>Pensando la fórmula para «{st.desc}»…</div>}
        {st.phase === 'preview' && <>
          <code className="aif-f">{st.formula}</code>
          <div className="aif-x">{st.explicacion}</div>
          <div className="aif-b"><button className="primary" onClick={insert}>Insertar</button><button onClick={() => setSt(null)}>Cancelar</button></div>
        </>}
        {st.phase === 'error' && <><div className="chat-error">{st.error}</div><div className="aif-b"><button onClick={() => setSt({ ...st, phase: 'ask' })}>Reintentar</button><button onClick={() => setSt(null)}>Cerrar</button></div></>}
      </div>}
    </span>
  );
}
