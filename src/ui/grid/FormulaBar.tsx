import { useEffect, useRef, useState } from 'react';
import * as S from '../../core/store';
import { parseRange, rangeToA1, toA1 } from '../../core/a1';
import { useStoreVersion, useEditVersion, focusGrid } from './Grid';
import { cursor, syncCursor, select, getEdit, startEdit, setEditValue, cancelEdit, commitEdit, setEditSource } from './gridState';
import './grid.css';
import { AiFormulaButton } from '../chat/AiFormula';

export function FormulaBar() {
  useStoreVersion();
  useEditVersion();
  const sel = syncCursor();
  const edit = getEdit();
  const sheetId = S.getSheet().id;
  const addr = sel.r1 === sel.r2 && sel.c1 === sel.c2 ? toA1(sel.r1, sel.c1) : rangeToA1(sel);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const inRef = useRef<HTMLInputElement>(null);

  const value = edit.editing ? edit.value : S.getInput(sel.sheetId || sheetId, cursor.activeR, cursor.activeC);

  useEffect(() => {
    if (edit.editing && edit.source === 'bar' && inRef.current && document.activeElement !== inRef.current) inRef.current.focus();
  });

  const finish = (dr: number, dc: number) => {
    const e = getEdit(); commitEdit();
    if (S.getWorkbook().activeSheetId !== e.sheetId) S.setActiveSheet(e.sheetId);
    const r = e.r + dr, c = e.c + dc; select(e.sheetId, r, c, r, c); focusGrid();
  };

  const goTo = (txt: string) => {
    let t = txt.trim(); let sid = S.getSheet().id;
    const bang = t.lastIndexOf('!');
    if (bang > 0) { const sh = S.getSheetByName(t.slice(0, bang).replace(/^'|'$/g, '')); if (sh) { sid = sh.id; S.setActiveSheet(sid); } t = t.slice(bang + 1); }
    try { const r = parseRange(t.toUpperCase()); select(sid, r.r1, r.c1, r.r2, r.c2); } catch { /* referencia inválida */ }
    setNameDraft(null); focusGrid();
  };

  return (
    <div className="ag-fbar">
      <input className="ag-namebox" aria-label="Cuadro de nombres" value={nameDraft ?? addr}
        onFocus={(e) => { setNameDraft(addr); setTimeout(() => e.target.select(), 0); }}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={() => setNameDraft(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') goTo(e.currentTarget.value); else if (e.key === 'Escape') { setNameDraft(null); focusGrid(); } }} />
      <button className="ag-fx" title="Insertar función" onClick={() => { if (!getEdit().editing) startEdit('bar', '='); else setEditSource('bar'); inRef.current?.focus(); }}>fx</button>
      <AiFormulaButton />
      <input ref={inRef} className="ag-finput" aria-label="Barra de fórmulas" spellCheck={false} autoComplete="off"
        value={value}
        onFocus={() => { if (!getEdit().editing) startEdit('bar'); else setEditSource('bar'); }}
        onChange={(e) => { if (!getEdit().editing) startEdit('bar'); setEditValue(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(e.shiftKey ? -1 : 1, 0); }
          else if (e.key === 'Tab') { e.preventDefault(); finish(0, e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); focusGrid(); }
        }} />
    </div>
  );
}
