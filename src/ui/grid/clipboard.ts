import * as S from '../../core/store';
import { shiftFormula, cursor } from './gridState';

interface InternalClip { text: string; inputs: string[][]; r: number; c: number; sheetId: string; cut: boolean }
let internal: InternalClip | null = null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let nativeFired = false;
export function markNative() { nativeFired = true; }

function buildCopy(cut: boolean) {
  const sel = S.getSelection();
  const sheetId = sel.sheetId || S.getWorkbook().activeSheetId;
  const rows: string[][] = []; const inputs: string[][] = [];
  for (let r = sel.r1; r <= sel.r2; r++) {
    if (S.isRowHidden(sheetId, r)) continue;
    const row: string[] = []; const inp: string[] = [];
    for (let c = sel.c1; c <= sel.c2; c++) { row.push(S.getDisplay(sheetId, r, c)); inp.push(S.getInput(sheetId, r, c)); }
    rows.push(row); inputs.push(inp);
  }
  const text = rows.map((r) => r.map((v) => (/[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join('\t')).join('\n');
  const html = '<table>' + rows.map((r) => '<tr>' + r.map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</table>';
  internal = { text, inputs, r: sel.r1, c: sel.c1, sheetId, cut };
  return { text, html };
}

export function copySelection(e: ClipboardEvent, cut: boolean) {
  nativeFired = true;
  const { text, html } = buildCopy(cut);
  e.clipboardData?.setData('text/plain', text);
  e.clipboardData?.setData('text/html', html);
  e.preventDefault();
}

/** Respaldo para Ctrl/Cmd+C/X/V cuando el navegador no dispara el evento nativo. */
export function keyboardClipboard(kind: 'copy' | 'cut' | 'paste') {
  nativeFired = false;
  setTimeout(async () => {
    if (nativeFired) return;
    try {
      if (kind === 'paste') {
        const t = await navigator.clipboard.readText();
        if (t) pasteText(t);
      } else {
        const { text, html } = buildCopy(kind === 'cut');
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
        } catch { await navigator.clipboard.writeText(text); }
      }
    } catch {
      // sin permiso del portapapeles: pegar desde el portapapeles interno
      if (kind === 'paste' && internal) pasteText(internal.text);
    }
  }, 60);
}

function parseTsv(t: string): string[][] {
  t = t.replace(/\r\n?/g, '\n');
  if (t.endsWith('\n')) t = t.slice(0, -1);
  const out: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur); out.push(row);
  return out;
}

export function pasteText(text: string) {
  const sel = S.getSelection();
  const sheetId = sel.sheetId || S.getWorkbook().activeSheetId;
  const r0 = sel.r1, c0 = sel.c1;
  const changes: { r: number; c: number; input: string }[] = [];
  let grid: string[][];
  let src: InternalClip | null = null;
  if (internal && internal.text === text) {
    src = internal;
    const dr = r0 - src.r, dc = c0 - src.c;
    grid = src.cut ? src.inputs : src.inputs.map((row) => row.map((v) => shiftFormula(v, dr, dc)));
  } else grid = parseTsv(text);
  const single = grid.length === 1 && grid[0].length === 1;
  if (single && (sel.r2 > sel.r1 || sel.c2 > sel.c1)) {
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
      const v = src && !src.cut ? shiftFormula(src.inputs[0][0], r - src.r, c - src.c) : grid[0][0];
      changes.push({ r, c, input: v });
    }
  } else {
    grid.forEach((row, i) => row.forEach((v, j) => changes.push({ r: r0 + i, c: c0 + j, input: v })));
  }
  const sh = S.getSheet(sheetId);
  const valid = changes.filter((x) => x.r < sh.rowCount && x.c < sh.colCount);
  if (src && src.cut) {
    S.beginTransaction('Cortar y pegar');
    try {
      const h = src.inputs.length, w = src.inputs[0]?.length ?? 0;
      const clear: { r: number; c: number; input: string }[] = [];
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) clear.push({ r: src.r + i, c: src.c + j, input: '' });
      if (src.sheetId === sheetId) {
        const targets = new Set(valid.map((x) => x.r + ':' + x.c));
        S.setInputs(sheetId, [...clear.filter((x) => !targets.has(x.r + ':' + x.c)), ...valid]);
      } else { S.setInputs(src.sheetId, clear); S.setInputs(sheetId, valid); }
    } finally { S.commitTransaction(); }
    internal = null;
  } else S.setInputs(sheetId, valid);
  if (!single || (sel.r1 === sel.r2 && sel.c1 === sel.c2)) {
    const h = grid.length, w = Math.max(...grid.map((r) => r.length));
    const r2 = Math.min(sh.rowCount - 1, r0 + h - 1), c2 = Math.min(sh.colCount - 1, c0 + w - 1);
    cursor.anchorR = cursor.activeR = r0; cursor.anchorC = cursor.activeC = c0;
    S.setSelection({ sheetId, r1: r0, c1: c0, r2, c2 });
  }
}
