import * as React from 'react';
import type { JSX } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as S from '../../core/store';
import { colToLetters } from '../../core/a1';
import { cursor, syncCursor, select, getEdit, getEditVersion, subscribeEdit, startEdit, setEditValue, cancelEdit, commitEdit, wantsRef, insertRef, setEditSource } from './gridState';
import { copySelection, pasteText, keyboardClipboard, markNative } from './clipboard';
import './grid.css';

const HH = 24, HW = 46, RH = 24, DEFAULT_W = 100;

export function useStoreVersion() { return useSyncExternalStore(S.subscribe, S.getVersion); }
export function useEditVersion() { return useSyncExternalStore(subscribeEdit, getEditVersion); }

let gridRootEl: HTMLDivElement | null = null;
export function focusGrid() { gridRootEl?.focus({ preventScroll: true }); }

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(t: string, bold?: boolean, italic?: boolean) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return t.length * 7;
  measureCtx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}13px 'Segoe UI', system-ui, -apple-system, sans-serif`;
  return measureCtx.measureText(t).width;
}

function lowerBound(arr: number[], x: number) { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }

export function Grid() {
  useStoreVersion();
  useEditVersion();
  const rootRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [view, setView] = useState({ w: 800, h: 600 });
  const [resize, setResize] = useState<{ c: number; w: number } | null>(null);
  const drag = useRef<null | { mode: 'cell' | 'col' | 'row' | 'ref'; r: number; c: number }>(null);
  const lastTap = useRef({ t: 0, r: -1, c: -1 });

  const sheet = S.getSheet();
  const sheetId = sheet.id;
  const sel = syncCursor();
  const edit = getEdit();
  const selOnSheet = sel.sheetId === sheetId;

  // geometría
  const colLeft = useMemo(() => {
    const a = [0];
    for (let c = 0; c < sheet.colCount; c++) a.push(a[c] + (resize && resize.c === c ? resize.w : (sheet.colWidths[c] ?? DEFAULT_W)));
    return a;
  }, [sheet, sheet.colWidths, sheet.colCount, resize, S.getVersion()]);
  const rowTop = useMemo(() => {
    const a = [0];
    for (let r = 0; r < sheet.rowCount; r++) a.push(a[r] + (S.isRowHidden(sheetId, r) ? 0 : RH));
    return a;
  }, [sheet, sheetId, sheet.rowCount, S.getVersion()]);
  const totalW = colLeft[colLeft.length - 1], totalH = rowTop[rowTop.length - 1];

  const c0 = Math.max(0, lowerBound(colLeft, scroll.x) - 1), c1 = Math.min(sheet.colCount - 1, lowerBound(colLeft, scroll.x + view.w));
  const r0 = Math.max(0, lowerBound(rowTop, scroll.y) - 1), r1 = Math.min(sheet.rowCount - 1, lowerBound(rowTop, scroll.y + view.h));

  useEffect(() => {
    gridRootEl = rootRef.current;
    const el = scRef.current!; const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // portapapeles: eventos nativos cuando el grid tiene el foco
  useEffect(() => {
    const ok = () => document.activeElement === rootRef.current && !getEdit().editing;
    const onCopy = (e: ClipboardEvent) => { if (ok()) copySelection(e, false); };
    const onCut = (e: ClipboardEvent) => { if (ok()) copySelection(e, true); };
    const onPaste = (e: ClipboardEvent) => { if (!ok()) return; markNative(); const t = e.clipboardData?.getData('text/plain'); if (t != null && t !== '') { e.preventDefault(); pasteText(t); } };
    document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste); };
  }, []);

  // llevar la celda activa a la vista cuando cambia la selección
  const selK = `${sel.sheetId}|${cursor.activeR}|${cursor.activeC}`;
  const prevSelK = useRef('');
  useLayoutEffect(() => {
    if (prevSelK.current === selK) return; prevSelK.current = selK;
    const el = scRef.current; if (!el || !selOnSheet) return;
    const x1 = colLeft[cursor.activeC], x2 = colLeft[cursor.activeC + 1], y1 = rowTop[cursor.activeR], y2 = rowTop[cursor.activeR + 1];
    if (x1 === undefined || y1 === undefined) return;
    if (x1 < el.scrollLeft) el.scrollLeft = x1; else if (x2 > el.scrollLeft + el.clientWidth) el.scrollLeft = x2 - el.clientWidth;
    if (y1 < el.scrollTop) el.scrollTop = y1; else if (y2 > el.scrollTop + el.clientHeight) el.scrollTop = y2 - el.clientHeight;
  });

  // foco del editor en celda
  const editingHere = edit.editing && edit.sheetId === sheetId;
  useEffect(() => {
    if (editingHere && edit.source === 'cell' && inputRef.current && document.activeElement !== inputRef.current) {
      const i = inputRef.current; i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length);
    }
  });
  useEffect(() => { if (edit.editing && edit.sheetId !== S.getWorkbook().activeSheetId && !edit.value.startsWith('=')) commitEdit(); }, [sheetId]);

  const hit = (clientX: number, clientY: number) => {
    const rect = scRef.current!.getBoundingClientRect();
    const x = clientX - rect.left + scRef.current!.scrollLeft, y = clientY - rect.top + scRef.current!.scrollTop;
    const c = Math.min(sheet.colCount - 1, Math.max(0, lowerBound(colLeft, x) - 1));
    let r = Math.min(sheet.rowCount - 1, Math.max(0, lowerBound(rowTop, y) - 1));
    while (r > 0 && rowTop[r + 1] === rowTop[r]) r--; // fila oculta
    return { r, c };
  };

  const finishAndFocus = (dr: number, dc: number) => {
    const e = getEdit();
    commitEdit();
    if (S.getWorkbook().activeSheetId !== e.sheetId) S.setActiveSheet(e.sheetId);
    move(e.r, e.c, dr, dc, false, e.sheetId);
    focusGrid();
  };

  // movimiento
  const nextVisibleRow = (r: number, d: number, sid: string) => { const sh = S.getSheet(sid); let x = r + d; while (x >= 0 && x < sh.rowCount && S.isRowHidden(sid, x)) x += d; return Math.max(0, Math.min(sh.rowCount - 1, x)); };
  function move(fromR: number, fromC: number, dr: number, dc: number, extend: boolean, sid = sheetId) {
    const r = dr ? nextVisibleRow(fromR, dr, sid) : fromR, c = fromC + dc;
    if (extend) select(sid, cursor.anchorR, cursor.anchorC, r, c, cursor.activeR, cursor.activeC);
    else select(sid, r, c, r, c);
  }
  function jumpEdge(r: number, c: number, dr: number, dc: number) {
    const sh = S.getSheet(sheetId);
    const has = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < sh.rowCount && cc < sh.colCount && S.getInput(sheetId, rr, cc) !== '';
    let nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= sh.rowCount || nc >= sh.colCount) return { r, c };
    if (has(r, c) && has(nr, nc)) { while (has(nr + dr, nc + dc)) { nr += dr; nc += dc; } return { r: nr, c: nc }; }
    while (!has(nr, nc) && nr + dr >= 0 && nc + dc >= 0 && nr + dr < sh.rowCount && nc + dc < sh.colCount) { nr += dr; nc += dc; }
    return { r: nr, c: nc };
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || getEdit().editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const ar = cursor.activeR, ac = cursor.activeC;
    const dirs: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (dirs[k]) {
      e.preventDefault();
      const [dr, dc] = dirs[k];
      if (mod) {
        const fr = e.shiftKey ? (dr ? (cursor.anchorR === sel.r1 ? sel.r2 : sel.r1) : ar) : ar;
        const fc = e.shiftKey ? (dc ? (cursor.anchorC === sel.c1 ? sel.c2 : sel.c1) : ac) : ac;
        const t = jumpEdge(fr, fc, dr, dc);
        if (e.shiftKey) select(sheetId, cursor.anchorR, cursor.anchorC, t.r, t.c, ar, ac); else select(sheetId, t.r, t.c, t.r, t.c);
      } else if (e.shiftKey) {
        const er = cursor.anchorR === sel.r1 ? sel.r2 : sel.r1, ec = cursor.anchorC === sel.c1 ? sel.c2 : sel.c1;
        select(sheetId, cursor.anchorR, cursor.anchorC, dr ? nextVisibleRow(er, dr, sheetId) : er, ec + dc, ar, ac);
      } else move(ar, ac, dr, dc, false);
      return;
    }
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'z' && !e.shiftKey) { e.preventDefault(); S.undo(); return; }
      if (lk === 'y' || (lk === 'z' && e.shiftKey)) { e.preventDefault(); S.redo(); return; }
      if (lk === 'b' || lk === 'i' || lk === 'u') {
        e.preventDefault();
        const prop = lk === 'b' ? 'bold' : lk === 'i' ? 'italic' : 'underline';
        const cur = S.getStyle(sheetId, ar, ac)[prop];
        S.setStyle(sheetId, sel, { [prop]: !cur });
        return;
      }
      if (lk === 'a') { e.preventDefault(); select(sheetId, 0, 0, sheet.rowCount - 1, sheet.colCount - 1, ar, ac); return; }
      if (k === 'Home') { e.preventDefault(); select(sheetId, 0, 0, 0, 0); return; }
      if (k === 'End') { e.preventDefault(); const u = S.usedRange(sheetId); if (u) select(sheetId, u.r2, u.c2, u.r2, u.c2); return; }
      if (lk === 'c' || lk === 'x' || lk === 'v') keyboardClipboard(lk === 'c' ? 'copy' : lk === 'x' ? 'cut' : 'paste');
      return; // dejar pasar copiar/cortar/pegar nativos
    }
    if (k === 'Home') { e.preventDefault(); select(sheetId, ar, 0, ar, 0); return; }
    if (k === 'Enter') { e.preventDefault(); move(ar, ac, e.shiftKey ? -1 : 1, 0, false); return; }
    if (k === 'Tab') { e.preventDefault(); move(ar, ac, 0, e.shiftKey ? -1 : 1, false); return; }
    if (k === 'F2') { e.preventDefault(); startEdit('cell'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); S.clearRange(sheetId, sel, 'contents'); return; }
    if (k === 'Escape') return;
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit('cell', k); }
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); finishAndFocus(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); finishAndFocus(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); const ed = getEdit(); cancelEdit(); if (S.getWorkbook().activeSheetId !== ed.sheetId) S.setActiveSheet(ed.sheetId); focusGrid(); }
  };

  // puntero sobre celdas
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { r, c } = hit(e.clientX, e.clientY);
    const ed = getEdit();
    if (ed.editing && wantsRef() && !(ed.sheetId === sheetId && ed.r === r && ed.c === c)) {
      e.preventDefault();
      insertRef(sheetId, r, c, r, c);
      drag.current = { mode: 'ref', r, c };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (ed.editing) { if (ed.sheetId === sheetId && ed.r === r && ed.c === c) return; commitEdit(); }
    const touch = e.pointerType === 'touch';
    if (touch) {
      const now = Date.now(); const lt = lastTap.current;
      if (now - lt.t < 350 && lt.r === r && lt.c === c) { lastTap.current = { t: 0, r: -1, c: -1 }; select(sheetId, r, c, r, c); startEdit('cell'); return; }
      lastTap.current = { t: now, r, c };
    }
    e.preventDefault();
    focusGrid();
    if (e.shiftKey) select(sheetId, cursor.anchorR, cursor.anchorC, r, c, cursor.activeR, cursor.activeC);
    else select(sheetId, r, c, r, c);
    if (!touch) { drag.current = { mode: 'cell', r, c }; (e.target as Element).setPointerCapture?.(e.pointerId); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const { r, c } = hit(e.clientX, e.clientY);
    if (d.mode === 'ref') { insertRef(sheetId, d.r, d.c, r, c); return; }
    if (d.mode === 'cell') select(sheetId, cursor.anchorR, cursor.anchorC, r, c, cursor.activeR, cursor.activeC);
  };
  const onPointerUp = () => { const d = drag.current; drag.current = null; if (d?.mode === 'ref') { setEditSource(getEdit().source); } };

  // encabezados
  const onColDown = (e: React.PointerEvent, c: number) => {
    if (e.button !== 0) return; e.preventDefault();
    if (getEdit().editing) commitEdit();
    focusGrid();
    const ac = e.shiftKey ? cursor.anchorC : c;
    select(sheetId, 0, ac, sheet.rowCount - 1, c, 0, ac);
    drag.current = { mode: 'col', r: 0, c: ac };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onColMove = (e: React.PointerEvent) => {
    if (drag.current?.mode !== 'col') return;
    const rect = scRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + scroll.x; const c = Math.min(sheet.colCount - 1, Math.max(0, lowerBound(colLeft, x) - 1));
    select(sheetId, 0, drag.current.c, sheet.rowCount - 1, c, 0, drag.current.c);
  };
  const onRowDown = (e: React.PointerEvent, r: number) => {
    if (e.button !== 0) return; e.preventDefault();
    if (getEdit().editing) commitEdit();
    focusGrid();
    const ar = e.shiftKey ? cursor.anchorR : r;
    select(sheetId, ar, 0, r, sheet.colCount - 1, ar, 0);
    drag.current = { mode: 'row', r: ar, c: 0 };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onRowMove = (e: React.PointerEvent) => {
    if (drag.current?.mode !== 'row') return;
    const rect = scRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top + scroll.y; const r = Math.min(sheet.rowCount - 1, Math.max(0, lowerBound(rowTop, y) - 1));
    select(sheetId, drag.current.r, 0, r, sheet.colCount - 1, drag.current.r, 0);
  };
  const onResizeDown = (e: React.PointerEvent, c: number) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = sheet.colWidths[c] ?? DEFAULT_W;
    let w = startW;
    const mv = (ev: PointerEvent) => { w = Math.max(24, Math.round(startW + ev.clientX - startX)); setResize({ c, w }); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setResize(null); if (w !== startW) S.setColWidth(sheetId, c, w); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const onWheelHeaders = (e: React.WheelEvent) => { scRef.current?.scrollBy(e.deltaX, e.deltaY); };

  // celdas visibles
  const cells: JSX.Element[] = [];
  for (let r = r0; r <= r1; r++) {
    if (rowTop[r + 1] === rowTop[r]) continue;
    for (let c = c0; c <= c1; c++) {
      const input = S.getInput(sheetId, r, c);
      const st = S.getStyle(sheetId, r, c);
      const hasStyle = !!(st.bg || st.border);
      if (input === '' && !hasStyle) continue;
      const val = input === '' ? null : S.getValue(sheetId, r, c);
      let disp = input === '' ? '' : S.getDisplay(sheetId, r, c);
      const isErr = !!val && typeof val === 'object' && 'error' in val;
      const isNum = typeof val === 'number';
      const align = st.align ?? (isNum ? 'right' : typeof val === 'boolean' || isErr ? 'center' : 'left');
      let w = colLeft[c + 1] - colLeft[c];
      // desborde de texto hacia celdas vacías (como Excel)
      if (align === 'left' && !isNum && disp) {
        let cc = c + 1;
        while (cc < sheet.colCount && cc <= c1 + 1 && S.getInput(sheetId, r, cc) === '' && w < textWidth(disp, st.bold, st.italic) + 8) { w += colLeft[cc + 1] - colLeft[cc]; cc++; }
      }
      if (isNum && textWidth(disp, st.bold, st.italic) > w - 9) disp = '#'.repeat(Math.max(1, Math.floor((w - 9) / 8)));
      cells.push(
        <div key={r + ':' + c} title={isNum && disp.startsWith('#') ? S.getDisplay(sheetId, r, c) : undefined} className={'ag-cell' + (st.border ? ' ag-border' : '')}
          style={{
            left: colLeft[c], top: rowTop[r], width: w - 1, height: RH - 1,
            fontWeight: st.bold ? 700 : undefined, fontStyle: st.italic ? 'italic' : undefined,
            textDecoration: st.underline ? 'underline' : undefined,
            color: isErr ? '#c42b1c' : st.color, background: st.bg ?? (disp ? 'var(--ag-cell-bg)' : undefined),
            justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          }}>{disp}</div>,
      );
    }
  }
  // líneas de cuadrícula
  const lines: JSX.Element[] = [];
  for (let c = c0; c <= c1; c++) lines.push(<div key={'v' + c} className="ag-vline" style={{ left: colLeft[c + 1] - 1, height: totalH }} />);
  for (let r = r0; r <= r1; r++) if (rowTop[r + 1] !== rowTop[r]) lines.push(<div key={'h' + r} className="ag-hline" style={{ top: rowTop[r + 1] - 1, width: totalW }} />);

  // selección
  const selBox = selOnSheet ? { left: colLeft[sel.c1], top: rowTop[sel.r1], width: colLeft[Math.min(sel.c2 + 1, sheet.colCount)] - colLeft[sel.c1], height: rowTop[Math.min(sel.r2 + 1, sheet.rowCount)] - rowTop[sel.r1] } : null;
  const act = selOnSheet ? { left: colLeft[cursor.activeC], top: rowTop[cursor.activeR], width: colLeft[cursor.activeC + 1] - colLeft[cursor.activeC], height: RH } : null;
  const multi = sel.r1 !== sel.r2 || sel.c1 !== sel.c2;

  // referencia que se está insertando
  const refBox = (() => {
    if (!edit.editing || edit.refStart < 0) return null;
    const txt = edit.value.slice(edit.refStart, edit.refEnd);
    const m = /^(?:(?:'[^']+'|[^!]+)!)?([A-Z]+\d+)(?::([A-Z]+\d+))?$/.exec(txt); if (!m) return null;
    if (txt.includes('!') !== (edit.sheetId !== sheetId)) return null;
    try {
      const p = (a: string) => { const mm = /^([A-Z]+)(\d+)$/.exec(a)!; let c = 0; for (const ch of mm[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { r: +mm[2] - 1, c: c - 1 }; };
      const a = p(m[1]), b = m[2] ? p(m[2]) : a;
      const ra = Math.min(a.r, b.r), rb = Math.max(a.r, b.r), ca = Math.min(a.c, b.c), cb = Math.max(a.c, b.c);
      return { left: colLeft[ca], top: rowTop[ra], width: colLeft[cb + 1] - colLeft[ca], height: rowTop[rb + 1] - rowTop[ra] };
    } catch { return null; }
  })();

  const editBox = editingHere ? (() => {
    const w = Math.max(colLeft[edit.c + 1] - colLeft[edit.c], Math.min(400, edit.value.length * 8 + 16));
    return { left: colLeft[edit.c], top: rowTop[edit.r], width: w, height: RH };
  })() : null;
  const editStyle = editingHere ? S.getStyle(sheetId, edit.r, edit.c) : {};

  const colSelected = (c: number) => selOnSheet && c >= sel.c1 && c <= sel.c2;
  const rowSelected = (r: number) => selOnSheet && r >= sel.r1 && r <= sel.r2;
  const fullCols = selOnSheet && sel.r1 === 0 && sel.r2 === sheet.rowCount - 1;
  const fullRows = selOnSheet && sel.c1 === 0 && sel.c2 === sheet.colCount - 1;
  const filt = sheet.filter;

  const colHeaders: JSX.Element[] = [];
  for (let c = c0; c <= c1; c++) {
    colHeaders.push(
      <div key={c} className={'ag-colh' + (colSelected(c) ? (fullCols ? ' ag-hsel-full' : ' ag-hsel') : '')}
        style={{ left: colLeft[c], width: colLeft[c + 1] - colLeft[c] }}
        onPointerDown={(e) => onColDown(e, c)} onPointerMove={onColMove} onPointerUp={onPointerUp}>
        {colToLetters(c)}{filt && filt.col === c ? <span className="ag-filter-ic" title="Filtro activo">▾</span> : null}
        <div className="ag-resize" onPointerDown={(e) => onResizeDown(e, c)} />
      </div>,
    );
  }
  const rowHeaders: JSX.Element[] = [];
  for (let r = r0; r <= r1; r++) {
    if (rowTop[r + 1] === rowTop[r]) continue;
    rowHeaders.push(
      <div key={r} className={'ag-rowh' + (rowSelected(r) ? (fullRows ? ' ag-hsel-full' : ' ag-hsel') : '') + (filt && r > filt.r1 && r <= filt.r2 && S.isRowHidden(sheetId, r + 1) ? ' ag-rowh-gap' : '')}
        style={{ top: rowTop[r], height: RH }}
        onPointerDown={(e) => onRowDown(e, r)} onPointerMove={onRowMove} onPointerUp={onPointerUp}>{r + 1}</div>,
    );
  }

  return (
    <div className="ag-grid" ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} data-sheet={sheetId} aria-label="Cuadrícula de la hoja">
      <div className="ag-corner" style={{ width: HW, height: HH }} title="Seleccionar todo"
        onPointerDown={(e) => { e.preventDefault(); focusGrid(); select(sheetId, 0, 0, sheet.rowCount - 1, sheet.colCount - 1, 0, 0); }} />
      <div className="ag-colhs" style={{ left: HW, height: HH }} onWheel={onWheelHeaders}>
        <div style={{ transform: `translateX(${-scroll.x}px)`, position: 'relative', height: HH, width: totalW }}>{colHeaders}</div>
      </div>
      <div className="ag-rowhs" style={{ top: HH, width: HW }} onWheel={onWheelHeaders}>
        <div style={{ transform: `translateY(${-scroll.y}px)`, position: 'relative', width: HW, height: totalH }}>{rowHeaders}</div>
      </div>
      <div className="ag-scroll" ref={scRef} style={{ left: HW, top: HH }}
        onScroll={(e) => { const t = e.currentTarget; setScroll({ x: t.scrollLeft, y: t.scrollTop }); }}>
        <div className="ag-canvas" style={{ width: totalW, height: totalH }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onDoubleClick={(e) => { const { r, c } = hit(e.clientX, e.clientY); if (getEdit().editing) return; select(sheetId, r, c, r, c); startEdit('cell'); }}>
          {lines}
          {cells}
          {selBox && multi && <div className="ag-selbox" style={selBox} />}
          {selBox && !multi && <div className="ag-selbox ag-selbox-single" style={selBox} />}
          {act && multi && <div className="ag-active" style={act} />}
          {refBox && <div className="ag-refbox" style={refBox} />}
          {editBox && (
            <input ref={inputRef} className="ag-editor" style={{ ...editBox, fontWeight: editStyle.bold ? 700 : undefined, fontStyle: editStyle.italic ? 'italic' : undefined, color: editStyle.color, background: editStyle.bg ?? '#fff' }}
              value={edit.value} spellCheck={false} autoComplete="off"
              onChange={(e) => setEditValue(e.target.value)} onKeyDown={onEditKey}
              onFocus={() => setEditSource('cell')}
              onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
          )}
        </div>
      </div>
    </div>
  );
}
