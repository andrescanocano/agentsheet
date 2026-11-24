// Estado local de la UI del grid (edición + celda activa), compartido entre Grid y FormulaBar.
import * as S from '../../core/store';
import { toA1 } from '../../core/a1';

export interface EditState {
  editing: boolean;
  sheetId: string;
  r: number; c: number;
  value: string;
  source: 'cell' | 'bar';
  refStart: number; refEnd: number; // última referencia insertada al editar fórmula (-1 si ninguna)
}

let edit: EditState = { editing: false, sheetId: '', r: 0, c: 0, value: '', source: 'cell', refStart: -1, refEnd: -1 };
let ver = 0;
const listeners = new Set<() => void>();
const emit = () => { ver++; listeners.forEach((l) => l()); };
export const subscribeEdit = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getEditVersion = () => ver;
export const getEdit = () => edit;

// celda activa / ancla (la selección del store es solo el rectángulo)
export const cursor = { anchorR: 0, anchorC: 0, activeR: 0, activeC: 0, lastSel: '' };

export function selKey(s: { sheetId: string; r1: number; c1: number; r2: number; c2: number }) {
  return `${s.sheetId}|${s.r1}|${s.c1}|${s.r2}|${s.c2}`;
}

/** Sincroniza el cursor con la selección del store (si el agente IA la cambió). */
export function syncCursor() {
  const s = S.getSelection();
  const k = selKey(s);
  if (k !== cursor.lastSel) {
    const inside = cursor.activeR >= s.r1 && cursor.activeR <= s.r2 && cursor.activeC >= s.c1 && cursor.activeC <= s.c2;
    if (!inside) { cursor.activeR = cursor.anchorR = s.r1; cursor.activeC = cursor.anchorC = s.c1; }
    cursor.lastSel = k;
  }
  return s;
}

export function select(sheetId: string, ar: number, ac: number, r: number, c: number, activeR = ar, activeC = ac) {
  const sh = S.getSheet(sheetId);
  const clampR = (x: number) => Math.max(0, Math.min(sh.rowCount - 1, x));
  const clampC = (x: number) => Math.max(0, Math.min(sh.colCount - 1, x));
  ar = clampR(ar); r = clampR(r); ac = clampC(ac); c = clampC(c);
  cursor.anchorR = ar; cursor.anchorC = ac; cursor.activeR = clampR(activeR); cursor.activeC = clampC(activeC);
  const sel = { sheetId, r1: Math.min(ar, r), c1: Math.min(ac, c), r2: Math.max(ar, r), c2: Math.max(ac, c) };
  cursor.lastSel = selKey(sel);
  S.setSelection(sel);
}

export function startEdit(source: 'cell' | 'bar', initial?: string) {
  const s = syncCursor();
  const sheetId = s.sheetId || S.getWorkbook().activeSheetId;
  const value = initial !== undefined ? initial : S.getInput(sheetId, cursor.activeR, cursor.activeC);
  edit = { editing: true, sheetId, r: cursor.activeR, c: cursor.activeC, value, source, refStart: -1, refEnd: -1 };
  emit();
}

export function setEditValue(value: string, keepRef = false) {
  if (!edit.editing) return;
  edit = { ...edit, value, refStart: keepRef ? edit.refStart : -1, refEnd: keepRef ? edit.refEnd : -1 };
  emit();
}

export function setEditSource(source: 'cell' | 'bar') { if (edit.editing && edit.source !== source) { edit = { ...edit, source }; emit(); } }

export function cancelEdit() {
  if (!edit.editing) return;
  edit = { ...edit, editing: false };
  emit();
}

export function commitEdit() {
  if (!edit.editing) return false;
  const { sheetId, r, c, value } = edit;
  edit = { ...edit, editing: false };
  emit();
  if (S.getInput(sheetId, r, c) !== value) S.setInputs(sheetId, [{ r, c, input: value }]);
  return true;
}

/** ¿El texto en edición admite insertar una referencia al hacer clic en una celda? */
export function wantsRef(): boolean {
  if (!edit.editing || !edit.value.startsWith('=')) return false;
  if (edit.refStart >= 0 && edit.refEnd === edit.value.length) return true;
  const last = edit.value.trimEnd().slice(-1);
  return '=(;,+-*/^&<>:'.includes(last);
}

export function insertRef(sheetId: string, r1: number, c1: number, r2: number, c2: number) {
  let ref = toA1(Math.min(r1, r2), Math.min(c1, c2));
  if (r1 !== r2 || c1 !== c2) ref += ':' + toA1(Math.max(r1, r2), Math.max(c1, c2));
  if (sheetId !== edit.sheetId) {
    const name = S.getSheet(sheetId).name;
    ref = (/^[A-Za-z_][\w]*$/.test(name) ? name : `'${name}'`) + '!' + ref;
  }
  const base = edit.refStart >= 0 && edit.refEnd === edit.value.length ? edit.value.slice(0, edit.refStart) : edit.value;
  edit = { ...edit, value: base + ref, refStart: base.length, refEnd: base.length + ref.length };
  emit();
}

/** Desplaza referencias relativas A1 (sin $) en una fórmula. */
export function shiftFormula(f: string, dr: number, dc: number): string {
  if (!f.startsWith('=')) return f;
  const parts = f.split(/("[^"]*")/); // no tocar cadenas
  return parts.map((p, i) => i % 2 === 1 ? p : p.replace(/(?<![A-Za-z0-9_.])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g,
    (m, d1: string, col: string, d2: string, row: string) => {
      let ci = 0; for (const ch of col.toUpperCase()) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1;
      let ri = parseInt(row, 10) - 1;
      if (!d1) ci += dc; if (!d2) ri += dr;
      if (ci < 0 || ri < 0) return '#REF!';
      let s = ''; let n = ci + 1; while (n > 0) { const md = (n - 1) % 26; s = String.fromCharCode(65 + md) + s; n = Math.floor((n - 1) / 26); }
      return `${d1}${s}${d2}${ri + 1}`;
    })).join('');
}
