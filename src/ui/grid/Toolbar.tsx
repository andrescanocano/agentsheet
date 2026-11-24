import { useRef, useState } from 'react';
import * as S from '../../core/store';
import { colToLetters } from '../../core/a1';
import type { NumFmt, CellStyle } from '../../core/types';
import { useStoreVersion, focusGrid } from './Grid';
import { cursor, syncCursor } from './gridState';
import './grid.css';

const DEF_DEC: Record<string, number> = { number: 2, cop: 2, percent: 0, integer: 0, general: 0, date: 0 };

const Ico = {
  undo: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 3 2 6l3 3" /><path d="M2 6h8a4 4 0 0 1 0 8H7" /></svg>,
  redo: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m11 3 3 3-3 3" /><path d="M14 6H6a4 4 0 0 0 0 8h3" /></svg>,
  left: <svg viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8" /></svg>,
  center: <svg viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6"><path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8" /></svg>,
  right: <svg viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6"><path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8" /></svg>,
  border: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="12" height="12" /><path d="M8 2v12M2 8h12" strokeDasharray="1.5 1.5" /></svg>,
  sortAsc: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2v12M1.5 11.5 4 14l2.5-2.5" /><text x="8" y="7" fontSize="6" fill="currentColor" stroke="none">A</text><text x="8" y="14" fontSize="6" fill="currentColor" stroke="none">Z</text></svg>,
  sortDesc: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2v12M1.5 11.5 4 14l2.5-2.5" /><text x="8" y="7" fontSize="6" fill="currentColor" stroke="none">Z</text><text x="8" y="14" fontSize="6" fill="currentColor" stroke="none">A</text></svg>,
  filter: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h12l-4.5 5.5V13L6.5 14V8.5z" /></svg>,
  open: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2 11v3h12v-3" /></svg>,
  save: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M2 11v3h12v-3" /></svg>,
  newb: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 1.5h6l3 3v10h-9z" /><path d="M9.5 1.5v3h3M8 7.5v5M5.5 10h5" /></svg>,
};

function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function Toolbar() {
  useStoreVersion();
  const sel = syncCursor();
  const sheet = S.getSheet();
  const sheetId = sheet.id;
  const st: CellStyle = S.getStyle(sheetId, cursor.activeR, cursor.activeC);
  const fileRef = useRef<HTMLInputElement>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState<null | { x: number; y: number; col: number; range: { r1: number; c1: number; r2: number; c2: number }; values: string[]; hidden: Set<string> }>(null);

  const range = { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 };
  const style = (patch: Partial<CellStyle>) => { S.setStyle(sheetId, range, patch); focusGrid(); };
  const toggle = (k: 'bold' | 'italic' | 'underline') => style({ [k]: !st[k] });
  const fmt = st.numFmt ?? 'general';
  const dec = (d: number) => {
    let f: NumFmt = fmt; if (f === 'general' || f === 'integer' || f === 'date') f = 'number';
    const cur = st.decimals ?? (fmt === 'general' || fmt === 'integer' ? (fmt === 'integer' ? 0 : 0) : DEF_DEC[f]);
    style({ numFmt: f, decimals: Math.max(0, Math.min(10, cur + d)) });
  };
  const sort = (asc: boolean) => {
    const u = S.usedRange(sheetId); if (!u) return;
    S.sortRange(sheetId, u, Math.min(Math.max(cursor.activeC, u.c1), u.c2), asc, true); focusGrid();
  };
  const openFilter = () => {
    if (pop) { setPop(null); return; }
    const u = S.usedRange(sheetId); if (!u) return;
    const f = sheet.filter;
    const col = f ? f.col : Math.min(Math.max(cursor.activeC, u.c1), u.c2);
    const rr = f ? { r1: f.r1, c1: f.c1, r2: f.r2, c2: f.c2 } : u;
    const vals = new Set<string>();
    for (let r = rr.r1 + 1; r <= rr.r2; r++) vals.add(S.getDisplay(sheetId, r, col));
    const b = filterBtn.current!.getBoundingClientRect();
    setPop({ x: Math.min(b.left, window.innerWidth - 250), y: b.bottom + 4, col, range: rr, values: [...vals].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })), hidden: new Set(f?.hidden ?? []) });
  };
  const onFile = async (file: File) => {
    try {
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') S.importCsv(await file.text(), file.name.replace(/\.[^.]+$/, ''));
      else S.importXlsx(await file.arrayBuffer());
    } catch (err) { alert('No se pudo importar: ' + (err as Error).message); }
  };
  const ulabel = S.undoLabel();

  return (
    <div className="ag-ribbon" role="toolbar" aria-label="Cinta de opciones">
      <div className="ag-brand"><i>A</i><span>AgentsSheet</span></div>
      <div className="ag-grp">
        <button className="ag-btn" title={ulabel ? `Deshacer: ${ulabel} (Ctrl+Z)` : 'Deshacer (Ctrl+Z)'} disabled={!S.canUndo()} onClick={() => { S.undo(); focusGrid(); }}>{Ico.undo}</button>
        <button className="ag-btn" title="Rehacer (Ctrl+Y)" disabled={!S.canRedo()} onClick={() => { S.redo(); focusGrid(); }}>{Ico.redo}</button>
      </div>
      <div className="ag-grp">
        <button className={'ag-btn' + (st.bold ? ' on' : '')} title="Negrita (Ctrl+B)" onClick={() => toggle('bold')}><b>N</b></button>
        <button className={'ag-btn' + (st.italic ? ' on' : '')} title="Cursiva (Ctrl+I)" onClick={() => toggle('italic')}><i style={{ fontFamily: 'Georgia, serif' }}>K</i></button>
        <button className={'ag-btn' + (st.underline ? ' on' : '')} title="Subrayado (Ctrl+U)" onClick={() => toggle('underline')}><u>S</u></button>
        <label className="ag-btn ag-color ag-colorbtn" title="Color de texto">
          <span style={{ fontWeight: 700 }}>A</span><span className="ag-swatch" style={{ background: st.color ?? '#c42b1c' }} />
          <input type="color" value={st.color ?? '#c42b1c'} onChange={(e) => style({ color: e.target.value })} />
        </label>
        <label className="ag-btn ag-color ag-colorbtn" title="Color de relleno">
          <svg viewBox="0 0 16 16" width="16" height="13" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m3 8 5-5 5 5-5 5z" /></svg><span className="ag-swatch" style={{ background: st.bg ?? '#fff2a8' }} />
          <input type="color" value={st.bg ?? '#fff2a8'} onChange={(e) => style({ bg: e.target.value })} />
        </label>
        <button className="ag-btn" title="Quitar formato" onClick={() => { S.clearRange(sheetId, range, 'formats'); focusGrid(); }}><span style={{ fontSize: 12 }}>✕</span></button>
      </div>
      <div className="ag-grp">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} className={'ag-btn' + (st.align === a ? ' on' : '')} title={{ left: 'Alinear a la izquierda', center: 'Centrar', right: 'Alinear a la derecha' }[a]} onClick={() => style({ align: st.align === a ? undefined : a })}>{Ico[a]}</button>
        ))}
        <button className={'ag-btn' + (st.border ? ' on' : '')} title="Bordes" onClick={() => style({ border: !st.border })}>{Ico.border}</button>
      </div>
      <div className="ag-grp">
        <select className="ag-select" title="Formato de número" value={fmt === 'integer' ? 'number' : fmt}
          onChange={(e) => style({ numFmt: e.target.value as NumFmt, decimals: undefined })}>
          <option value="general">General</option>
          <option value="number">Número</option>
          <option value="cop">Moneda COP</option>
          <option value="percent">Porcentaje</option>
          <option value="date">Fecha</option>
        </select>
        <button className="ag-btn" title="Aumentar decimales" onClick={() => dec(1)}><span style={{ fontSize: 11 }}>,0→,00</span></button>
        <button className="ag-btn" title="Disminuir decimales" onClick={() => dec(-1)}><span style={{ fontSize: 11 }}>,00→,0</span></button>
      </div>
      <div className="ag-grp">
        <button className="ag-btn" title="Ordenar A → Z por la columna activa" onClick={() => sort(true)}>{Ico.sortAsc}<span className="lbl">A→Z</span></button>
        <button className="ag-btn" title="Ordenar Z → A por la columna activa" onClick={() => sort(false)}>{Ico.sortDesc}<span className="lbl">Z→A</span></button>
        <button ref={filterBtn} className={'ag-btn' + (sheet.filter ? ' on' : '')} title="Filtro" onClick={openFilter}>{Ico.filter}<span className="lbl">Filtro</span></button>
      </div>
      <div className="ag-grp">
        <button className="ag-btn" title="Importar .xlsx o .csv" onClick={() => fileRef.current?.click()}>{Ico.open}<span className="lbl">Importar</span></button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        <button className="ag-btn" title="Exportar a Excel (.xlsx)" onClick={() => download(S.exportXlsx(), 'AgentsSheet.xlsx')}>{Ico.save}<span className="lbl">.xlsx</span></button>
        <button className="ag-btn" title="Exportar hoja a .csv" onClick={() => download(new Blob([S.exportCsv(sheetId)], { type: 'text/csv;charset=utf-8' }), sheet.name + '.csv')}>{Ico.save}<span className="lbl">.csv</span></button>
        <button className="ag-btn" title="Nuevo libro" onClick={() => { if (confirm('¿Crear un libro nuevo? Se perderá el contenido actual.')) S.resetWorkbook(); }}>{Ico.newb}<span className="lbl">Nuevo</span></button>
      </div>
      <div id="toolbar-extra" />
      {pop && (
        <div className="ag-pop" style={{ left: pop.x, top: pop.y }} onKeyDown={(e) => { if (e.key === 'Escape') setPop(null); }}>
          <h4>Filtrar columna {colToLetters(pop.col)}: {S.getDisplay(sheetId, pop.range.r1, pop.col) || '(encabezado)'}</h4>
          <label><input type="checkbox" checked={pop.hidden.size === 0} onChange={(e) => setPop({ ...pop, hidden: e.target.checked ? new Set() : new Set(pop.values) })} /> (Seleccionar todo)</label>
          <div className="list">
            {pop.values.map((v) => (
              <label key={v}><input type="checkbox" checked={!pop.hidden.has(v)} onChange={() => { const h = new Set(pop.hidden); if (h.has(v)) h.delete(v); else h.add(v); setPop({ ...pop, hidden: h }); }} /> {v === '' ? '(Vacías)' : v}</label>
            ))}
          </div>
          <div className="row">
            <button className="ag-btn" onClick={() => { S.setFilter(sheetId, null); setPop(null); focusGrid(); }}>Quitar filtro</button>
            <button className="ag-btn ag-btn-primary" onClick={() => { S.setFilter(sheetId, { ...pop.range, col: pop.col, hidden: [...pop.hidden] }); setPop(null); focusGrid(); }}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}
