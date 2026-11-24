// CONTRATO del store (lo implementa el agente Core). Todos los demás importan SOLO de aquí y de types.ts / a1.ts.
// Implementación real: HyperFormula (es-ES, ';' y coma decimal) + snapshots para deshacer + localStorage.
// Nota: al ordenar, las fórmulas que apuntan a su propia fila se reajustan con una regex simple;
// referencias a otras filas del rango ordenado pueden quedar desalineadas (aceptado para la demo).
import { HyperFormula } from 'hyperformula';
import esES from 'hyperformula/i18n/languages/esES';
import * as XLSX from 'xlsx';
import type { Workbook, SheetData, Selection, CellValue, CellChange, CellStyle, ChartData, Macro, NumFmt } from './types';
import { key, toA1 } from './a1';
import * as self from './store';

export type Listener = () => void;

// ---------- motor ----------
try { HyperFormula.registerLanguage('esES', esES as any); } catch { /* ya registrado */ }
const HF_CONFIG: any = {
  licenseKey: 'gpl-v3', language: 'esES', functionArgSeparator: ';', decimalSeparator: ',', thousandSeparator: '.',
  dateFormats: ['DD/MM/YYYY', 'DD/MM/YY'], currencySymbol: ['$'], useArrayArithmetic: false,
};
let hf: HyperFormula = HyperFormula.buildEmpty(HF_CONFIG);

const uid = () => (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const clone = <T>(x: T): T => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

function newSheet(name: string): SheetData { return { id: uid(), name, cells: {}, colWidths: {}, rowCount: 200, colCount: 26, filter: null }; }
function defaultWorkbook(): Workbook { const s = newSheet('Hoja1'); return { sheets: [s], activeSheetId: s.id, charts: [], macros: [] }; }

// ---------- estado ----------
const LS_KEY = 'agentsheet.v1';
const hasLS = () => { try { return typeof localStorage !== 'undefined'; } catch { return false; } };
function loadInitial(): Workbook {
  if (hasLS()) { try { const raw = localStorage.getItem(LS_KEY); if (raw) { const w = JSON.parse(raw) as Workbook; if (w && Array.isArray(w.sheets) && w.sheets.length) { w.charts ??= []; w.macros ??= []; if (!w.sheets.find(s => s.id === w.activeSheetId)) w.activeSheetId = w.sheets[0].id; return w; } } } catch { /* ignora */ } }
  return defaultWorkbook();
}
let wb: Workbook = loadInitial();
let selection: Selection = { sheetId: wb.activeSheetId, r1: 0, c1: 0, r2: 0, c2: 0 };
let version = 0;
const listeners = new Set<Listener>();
let notifyQueued = false;
let saveTimer: any = null;

function changed(persist = true) {
  version++;
  if (!notifyQueued) { notifyQueued = true; queueMicrotask(() => { notifyQueued = false; for (const l of [...listeners]) { try { l(); } catch (e) { console.error(e); } } }); }
  if (persist && hasLS()) { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(wb)); } catch { /* cuota */ } }, 300); }
}

// ---------- undo ----------
interface Step { snap: Workbook; label: string }
const undoStack: Step[] = []; const redoStack: Step[] = [];
let txDepth = 0;
const MAX_UNDO = 100;
function pushUndo(label: string) { undoStack.push({ snap: clone(wb), label }); if (undoStack.length > MAX_UNDO) undoStack.shift(); redoStack.length = 0; }
function mutate<T>(label: string, fn: () => T): T { if (txDepth === 0) pushUndo(label); const r = fn(); changed(); return r; }

// ---------- conversión de entrada ----------
const NUM_RE = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
/** Analiza texto como lo teclea un usuario colombiano. Devuelve número o null. */
export function parseNumberEs(text: string): { n: number; fmt?: NumFmt } | null {
  let t = text.trim(); if (!t) return null;
  let fmt: NumFmt | undefined; let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1).trim(); }
  if (t.includes('$')) { fmt = 'cop'; t = t.replace(/\$/g, '').trim(); if (t.startsWith('-')) { neg = !neg; t = t.slice(1).trim(); } }
  let pct = false; if (t.endsWith('%')) { pct = true; fmt = 'percent'; t = t.slice(0, -1).trim(); }
  t = t.replace(/\s/g, '');
  if (!NUM_RE.test(t)) return null;
  let n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (pct) n = n / 100; if (neg) n = -n;
  return { n, fmt };
}
/** Recorre una fórmula aplicando fn solo a los trozos fuera de comillas. */
function outsideStrings(f: string, fn: (s: string) => string): string {
  const parts = f.split(/("(?:[^"]|"")*")/); return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join('');
}
function fixFormula(f: string): string {
  // VERDADERO / FALSO sueltos → funciones (HF los trata como nombres si no llevan paréntesis)
  return outsideStrings(f, s => s.replace(/(^|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9_.!$])(VERDADERO|FALSO|TRUE|FALSE)(?![A-Za-z0-9_.(]|\s*\()/gi, (_m, a, b) => a + b.toUpperCase() + '()'));
}
function toHfContent(input: string): { content: any; fmt?: NumFmt } {
  if (input === '' || input == null) return { content: null };
  if (input.startsWith('=')) return { content: fixFormula(input) };
  const p = parseNumberEs(input); if (p) return { content: p.n, fmt: p.fmt };
  const up = input.trim().toUpperCase();
  if (up === 'VERDADERO') return { content: true }; if (up === 'FALSO') return { content: false };
  return { content: input };
}

// ---------- motor <-> libro ----------
function hfSheet(sheetId: string): number { const s = getSheet(sheetId); const id = hf.getSheetId(s.name); if (id === undefined) throw new Error('Hoja no está en el motor: ' + s.name); return id; }
function sheetMatrix(s: SheetData): any[][] {
  const m: any[][] = [];
  for (const [k, cd] of Object.entries(s.cells)) { if (!cd.input) continue; const [r, c] = k.split(':').map(Number); (m[r] ??= [])[c] = toHfContent(cd.input).content; }
  for (let r = 0; r < m.length; r++) { m[r] ??= []; for (let c = 0; c < m[r].length; c++) if (m[r][c] === undefined) m[r][c] = null; }
  return m;
}
/** Reconstruye HyperFormula completo desde el libro (undo, import, ordenar). */
export function rebuildEngine() {
  try { hf.destroy(); } catch { /* */ }
  const sheets: Record<string, any[][]> = {}; for (const s of wb.sheets) sheets[s.name] = sheetMatrix(s);
  hf = HyperFormula.buildFromSheets(sheets, HF_CONFIG);
}
rebuildEngine();

// ---------- suscripción ----------
export function subscribe(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getVersion(): number { return version; }
export function getWorkbook(): Workbook { return wb; }
export function getSheet(sheetId?: string): SheetData {
  const id = sheetId ?? wb.activeSheetId; return wb.sheets.find(s => s.id === id) ?? wb.sheets.find(s => s.id === wb.activeSheetId) ?? wb.sheets[0];
}
export function getSheetByName(name: string): SheetData | undefined { const n = name.toLowerCase(); return wb.sheets.find(s => s.name.toLowerCase() === n); }
export function setActiveSheet(sheetId: string): void { if (!wb.sheets.find(s => s.id === sheetId)) return; wb.activeSheetId = sheetId; selection = { sheetId, r1: 0, c1: 0, r2: 0, c2: 0 }; changed(); }

// ---------- celdas ----------
export function getInput(sheetId: string, r: number, c: number): string { return getSheet(sheetId).cells[key(r, c)]?.input ?? ''; }
export function getValue(sheetId: string, r: number, c: number): CellValue {
  const s = getSheet(sheetId); if (!s.cells[key(r, c)]?.input) return null;
  let v: any; try { v = hf.getCellValue({ sheet: hfSheet(s.id), row: r, col: c }); } catch { return { error: '#¡REF!' }; }
  if (v && typeof v === 'object') { const t = (v as any).type; if (t === 'CYCLE') return { error: '#CICLO!' }; const code = String((v as any).value ?? '#¡VALOR!'); return { error: code === '#N/D' ? '#N/A' : code }; }
  if (v === undefined) return null;
  return v as CellValue;
}
const nf = (min: number, max: number, grouping = true) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping });
function serialToDate(n: number): string {
  const ms = Math.round((n - 25569) * 86400000); const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0'); return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
/** Formatea un número según el formato (es-CO). Exportado para gráficos/IA. */
export function formatNumber(n: number, fmt: NumFmt = 'general', decimals?: number): string {
  if (!isFinite(n)) return String(n);
  switch (fmt) {
    case 'cop': { const d = decimals ?? 2; const s = nf(d, d).format(Math.abs(n)); return (n < 0 ? '-$ ' : '$ ') + s; }
    case 'number': { const d = decimals ?? 2; return nf(d, d).format(n); }
    case 'integer': return nf(0, 0).format(n);
    case 'percent': { const d = decimals ?? 0; return nf(d, d).format(n * 100) + '%'; }
    case 'date': return serialToDate(n);
    default: { const r = Number(n.toPrecision(15)); return nf(0, 10, Math.abs(r) >= 1000).format(r); }
  }
}
export function getDisplay(sheetId: string, r: number, c: number): string {
  const v = getValue(sheetId, r, c); if (v === null || v === undefined) return '';
  if (typeof v === 'object') return v.error;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'number') { const st = getStyle(sheetId, r, c); return formatNumber(v, st.numFmt ?? 'general', st.decimals); }
  return String(v);
}
export function getStyle(sheetId: string, r: number, c: number): CellStyle { return getSheet(sheetId).cells[key(r, c)]?.style ?? {}; }

function applyInputs(s: SheetData, changes: CellChange[]) {
  const hid = hfSheet(s.id);
  hf.batch(() => {
    for (const ch of changes) {
      const k = key(ch.r, ch.c); const input = ch.input ?? '';
      const { content, fmt } = toHfContent(input);
      if (!input) { const cd = s.cells[k]; if (cd) { delete cd.input; if (!cd.style || !Object.keys(cd.style).length) delete s.cells[k]; } }
      else { const cd = (s.cells[k] ??= {}); cd.input = input; if (fmt) cd.style = { ...(cd.style ?? {}), numFmt: fmt }; }
      if (ch.r >= s.rowCount) s.rowCount = ch.r + 50; if (ch.c >= s.colCount) s.colCount = ch.c + 5;
      hf.setCellContents({ sheet: hid, row: ch.r, col: ch.c }, [[content]]);
    }
  });
  // fechas reconocidas por el motor → formato fecha
  for (const ch of changes) {
    if (!ch.input || ch.input.startsWith('=')) continue; const cd = s.cells[key(ch.r, ch.c)]; if (!cd || cd.style?.numFmt) continue;
    try { const t = hf.getCellValueDetailedType({ sheet: hid, row: ch.r, col: ch.c }); if (String(t).startsWith('NUMBER_DATE')) cd.style = { ...(cd.style ?? {}), numFmt: 'date' }; } catch { /* */ }
  }
}
export function setInputs(sheetId: string, changes: CellChange[]): void {
  const s = getSheet(sheetId); if (!changes.length) return;
  mutate(changes.length === 1 ? 'Editar ' + toA1(changes[0].r, changes[0].c) : `Editar ${changes.length} celdas`, () => applyInputs(s, changes));
}
type Rect = { r1: number; c1: number; r2: number; c2: number };
export function setStyle(sheetId: string, sel: Rect, patch: Partial<CellStyle>): void {
  const s = getSheet(sheetId);
  mutate('Formato', () => { for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) { const cd = (s.cells[key(r, c)] ??= {}); const st = { ...(cd.style ?? {}), ...patch }; for (const k of Object.keys(st) as (keyof CellStyle)[]) if (st[k] === undefined) delete st[k]; cd.style = st; } });
}
export function clearRange(sheetId: string, sel: Rect, what: 'all' | 'contents' | 'formats' = 'all'): void {
  const s = getSheet(sheetId);
  mutate('Borrar', () => {
    const changes: CellChange[] = [];
    for (const k of Object.keys(s.cells)) { const [r, c] = k.split(':').map(Number); if (r < sel.r1 || r > sel.r2 || c < sel.c1 || c > sel.c2) continue; const cd = s.cells[k];
      if (what !== 'formats' && cd.input) changes.push({ r, c, input: '' });
      if (what !== 'contents') delete cd.style; }
    applyInputs(s, changes);
    for (const k of Object.keys(s.cells)) { const cd = s.cells[k]; if (!cd.input && (!cd.style || !Object.keys(cd.style).length)) delete s.cells[k]; }
  });
}
export function setColWidth(sheetId: string, c: number, px: number): void { const s = getSheet(sheetId); mutate('Ancho de columna', () => { s.colWidths[c] = Math.max(20, Math.round(px)); }); }
export function usedRange(sheetId: string): Rect | null {
  const s = getSheet(sheetId); let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
  for (const [k, cd] of Object.entries(s.cells)) { if (!cd.input) continue; const [r, c] = k.split(':').map(Number); r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c); }
  return r2 < 0 ? null : { r1, c1, r2, c2 };
}
export function getDependents(sheetId: string, r: number, c: number): string[] {
  try { const deps = hf.getCellDependents({ sheet: hfSheet(sheetId), row: r, col: c }) as any[];
    return deps.map(d => { if ('row' in d && 'col' in d) { const name = hf.getSheetName(d.sheet); return (name && name !== getSheet(sheetId).name ? name + '!' : '') + toA1(d.row, d.col); } if (d.start && d.end) return toA1(d.start.row, d.start.col) + ':' + toA1(d.end.row, d.end.col); return String(d); });
  } catch { return []; }
}

// ---------- hojas ----------
function uniqueName(base: string): string { if (!getSheetByName(base)) return base; let i = 2; const m = /^(.*?)(\d+)$/.exec(base); const stem = m ? m[1] : base; if (m) i = parseInt(m[2], 10) + 1; while (getSheetByName(stem + i)) i++; return stem + i; }
function nextSheetName(): string { let i = wb.sheets.length + 1; while (getSheetByName('Hoja' + i)) i++; return 'Hoja' + i; }
export function addSheet(name?: string): SheetData {
  return mutate('Nueva hoja', () => { const s = newSheet(name ? uniqueName(name) : nextSheetName()); wb.sheets.push(s); hf.addSheet(s.name); wb.activeSheetId = s.id; selection = { sheetId: s.id, r1: 0, c1: 0, r2: 0, c2: 0 }; return s; });
}
/** Tras renombrar, el motor reescribe las fórmulas: copiamos su versión al input. */
function syncFormulaInputsFromEngine() {
  for (const s of wb.sheets) { const id = hf.getSheetId(s.name); if (id === undefined) continue;
    for (const [k, cd] of Object.entries(s.cells)) { if (!cd.input?.startsWith('=')) continue; const [r, c] = k.split(':').map(Number); try { const f = hf.getCellFormula({ sheet: id, row: r, col: c }); if (f) cd.input = outsideStrings(f, x => x.replace(/\b(VERDADERO|FALSO)\(\)/g, '$1')); } catch { /* */ } } }
}
export function renameSheet(sheetId: string, name: string): void {
  const s = getSheet(sheetId); name = name.trim(); if (!name || name === s.name) return;
  const other = getSheetByName(name); if (other && other.id !== s.id) throw new Error('Ya existe una hoja llamada ' + name);
  mutate('Renombrar hoja', () => { hf.renameSheet(hfSheet(s.id), name); s.name = name; syncFormulaInputsFromEngine(); });
}
export function deleteSheet(sheetId: string): void {
  if (wb.sheets.length <= 1) return; const s = getSheet(sheetId);
  mutate('Eliminar hoja', () => { try { hf.removeSheet(hfSheet(s.id)); } catch { /* */ } wb.sheets = wb.sheets.filter(x => x.id !== s.id); wb.charts = wb.charts.filter(ch => ch.sheetId !== s.id); syncFormulaInputsFromEngine();
    if (wb.activeSheetId === s.id) wb.activeSheetId = wb.sheets[0].id; if (selection.sheetId === s.id) selection = { sheetId: wb.activeSheetId, r1: 0, c1: 0, r2: 0, c2: 0 }; });
}

// ---------- datos ----------
function cmpValues(a: CellValue, b: CellValue): number {
  const rank = (v: CellValue) => v === null || v === '' ? 4 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3;
  const ra = rank(a), rb = rank(b); if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return 0;
}
function shiftOwnRow(input: string, from: number, to: number): string {
  if (!input.startsWith('=') || from === to) return input;
  return outsideStrings(input, s => s.replace(/(\$?[A-Za-z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, col, dollar, row) => (!dollar && parseInt(row, 10) === from + 1 ? col + (to + 1) : m)));
}
export function sortRange(sheetId: string, sel: Rect, col: number, asc: boolean, hasHeader = false): void {
  const s = getSheet(sheetId); const start = hasHeader ? sel.r1 + 1 : sel.r1; if (start >= sel.r2) return;
  mutate('Ordenar', () => {
    const rows: { r: number; v: CellValue; cells: Record<number, any> }[] = [];
    for (let r = start; r <= sel.r2; r++) { const cells: Record<number, any> = {}; for (let c = sel.c1; c <= sel.c2; c++) { const cd = s.cells[key(r, c)]; if (cd) cells[c] = clone(cd); } rows.push({ r, v: getValue(s.id, r, col), cells }); }
    const empty = (v: CellValue) => v === null || v === '';
    rows.sort((a, b) => { if (empty(a.v) !== empty(b.v)) return empty(a.v) ? 1 : -1; const d = cmpValues(a.v, b.v); return asc ? d : -d; });
    for (let r = start; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) delete s.cells[key(r, c)];
    rows.forEach((row, i) => { const to = start + i; for (const [c, cd] of Object.entries(row.cells)) { if (cd.input) cd.input = shiftOwnRow(cd.input, row.r, to); s.cells[key(to, Number(c))] = cd; } });
    rebuildEngine();
  });
}
export function setFilter(sheetId: string, f: SheetData['filter']): void { const s = getSheet(sheetId); mutate(f ? 'Filtro' : 'Quitar filtro', () => { s.filter = f ? clone(f) : null; }); }
export function isRowHidden(sheetId: string, r: number): boolean {
  const f = getSheet(sheetId).filter; if (!f || !f.hidden?.length) return false; if (r <= f.r1 || r > f.r2) return false;
  return f.hidden.includes(getDisplay(sheetId, r, f.col));
}

// ---------- selección ----------
export function getSelection(): Selection { return selection; }
export function setSelection(sel: Selection): void {
  selection = { sheetId: sel.sheetId, r1: Math.min(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), r2: Math.max(sel.r1, sel.r2), c2: Math.max(sel.c1, sel.c2) }; changed(false);
}

// ---------- gráficos y macros ----------
export function addChart(ch: Omit<ChartData, 'id'>): ChartData { return mutate('Nuevo gráfico', () => { const c = { ...ch, id: uid() }; wb.charts.push(c); return c; }); }
export function updateChart(id: string, patch: Partial<ChartData>): void { const c = wb.charts.find(x => x.id === id); if (!c) return; mutate('Editar gráfico', () => { Object.assign(c, patch, { id }); }); }
export function removeChart(id: string): void { mutate('Eliminar gráfico', () => { wb.charts = wb.charts.filter(x => x.id !== id); }); }
export function saveMacro(m: Omit<Macro, 'id'> & { id?: string }): Macro {
  return mutate('Guardar macro', () => { const ex = m.id ? wb.macros.find(x => x.id === m.id) : undefined; if (ex) { Object.assign(ex, m); return ex; } const n: Macro = { ...m, id: m.id ?? uid() } as Macro; wb.macros.push(n); return n; });
}
export function deleteMacro(id: string): void { mutate('Eliminar macro', () => { wb.macros = wb.macros.filter(x => x.id !== id); }); }

// ---------- deshacer / rehacer ----------
export function beginTransaction(label: string): void { if (txDepth === 0) pushUndo(label); txDepth++; }
export function commitTransaction(): void {
  if (txDepth === 0) return; txDepth--;
  if (txDepth === 0) { const top = undoStack[undoStack.length - 1]; if (top && JSON.stringify(top.snap) === JSON.stringify(wb)) undoStack.pop(); changed(); }
}
function restore(snap: Workbook) { const active = wb.activeSheetId; wb = clone(snap); if (wb.sheets.find(s => s.id === active)) wb.activeSheetId = active; rebuildEngine(); if (!wb.sheets.find(s => s.id === selection.sheetId)) selection = { sheetId: wb.activeSheetId, r1: 0, c1: 0, r2: 0, c2: 0 }; changed(); }
export function undo(): void { const st = undoStack.pop(); if (!st) return; redoStack.push({ snap: clone(wb), label: st.label }); restore(st.snap); }
export function redo(): void { const st = redoStack.pop(); if (!st) return; undoStack.push({ snap: clone(wb), label: st.label }); restore(st.snap); }
export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }
export function undoLabel(): string | null { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }

// ---------- traducción de fórmulas es <-> en ----------
const ES_EN: Record<string, string> = {
  'SUMA': 'SUM', 'PROMEDIO': 'AVERAGE', 'CONTAR': 'COUNT', 'CONTARA': 'COUNTA', 'SI': 'IF', 'SUMAR.SI': 'SUMIF', 'CONTAR.SI': 'COUNTIF',
  'BUSCARV': 'VLOOKUP', 'BUSCARH': 'HLOOKUP', 'BUSCARX': 'XLOOKUP', 'MAX': 'MAX', 'MIN': 'MIN', 'REDONDEAR': 'ROUND', 'Y': 'AND', 'O': 'OR',
  'SI.ERROR': 'IFERROR', 'HOY': 'TODAY', 'AHORA': 'NOW', 'CONCATENAR': 'CONCATENATE', 'PROMEDIO.SI': 'AVERAGEIF', 'SUMAR.SI.CONJUNTO': 'SUMIFS',
  'CONTAR.SI.CONJUNTO': 'COUNTIFS', 'VERDADERO': 'TRUE', 'FALSO': 'FALSE', 'ABS': 'ABS', 'NO': 'NOT', 'INDICE': 'INDEX', 'COINCIDIR': 'MATCH',
  'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN', 'TEXTO': 'TEXT', 'IZQUIERDA': 'LEFT', 'DERECHA': 'RIGHT', 'LARGO': 'LEN',
  'MAYUSC': 'UPPER', 'MINUSC': 'LOWER', 'ESPACIOS': 'TRIM', 'FECHA': 'DATE', 'AÑO': 'YEAR', 'MES': 'MONTH', 'DIA': 'DAY', 'ENTERO': 'INT',
  'RESIDUO': 'MOD', 'POTENCIA': 'POWER', 'RAIZ': 'SQRT', 'PRODUCTO': 'PRODUCT', 'SUMAPRODUCTO': 'SUMPRODUCT', 'ESBLANCO': 'ISBLANK', 'ESERROR': 'ISERROR',
  'PAGO': 'PMT', 'VNA': 'NPV', 'TIR': 'IRR', 'VA': 'PV', 'VF': 'FV',
};
const EN_ES: Record<string, string> = Object.fromEntries(Object.entries(ES_EN).map(([a, b]) => [b, a]));
const FN_RE = /([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ_.]*)(\s*\()/g;
/** "=SUMA(A1;1,5)" → "SUM(A1,1.5)" (sin '='), formato de Excel en inglés. */
export function formulaToEnglish(f: string): string {
  const body = f.startsWith('=') ? f.slice(1) : f;
  return outsideStrings(body, s => s.replace(/\b(VERDADERO|FALSO|TRUE|FALSE)\(\)/gi, '$1').replace(FN_RE, (m, name, p) => (ES_EN[name.toUpperCase()] ?? name) + p)
    .replace(/\b(VERDADERO|FALSO)\b(?!\s*\()/gi, w => ES_EN[w.toUpperCase()])
    .replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ','));
}
/** "SUM(A1,1.5)" → "=SUMA(A1;1,5)". */
export function formulaToSpanish(f: string): string {
  const body = f.startsWith('=') ? f.slice(1) : f;
  return '=' + outsideStrings(body, s => s.replace(/,/g, ';').replace(/(\d)\.(\d)/g, '$1,$2')
    .replace(/_xlfn\./gi, '').replace(FN_RE, (m, name, p) => (EN_ES[name.toUpperCase()] ?? name) + p)
    .replace(/\b(TRUE|FALSE)\b(?!\s*\()/gi, w => EN_ES[w.toUpperCase()]));
}

// ---------- archivos ----------
function numberToInputEs(n: number): string { return String(n).replace('.', ','); }
export function importXlsx(buf: ArrayBuffer): void {
  const x = XLSX.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellStyles: false });
  const sheets: SheetData[] = [];
  for (const name of x.SheetNames) {
    const ws = x.Sheets[name]; const s = newSheet(name.slice(0, 31)); const ref = ws['!ref'];
    if (ref) { const rg = XLSX.utils.decode_range(ref);
      for (let r = rg.s.r; r <= rg.e.r; r++) for (let c = rg.s.c; c <= rg.e.c; c++) { const cell: any = ws[XLSX.utils.encode_cell({ r, c })]; if (!cell) continue;
        let input = ''; const style: CellStyle = {};
        if (cell.f) input = formulaToSpanish(cell.f);
        else if (cell.t === 'n') input = numberToInputEs(cell.v);
        else if (cell.t === 'b') input = cell.v ? 'VERDADERO' : 'FALSO';
        else if (cell.t === 'd') input = String(cell.w ?? cell.v);
        else if (cell.v != null) input = String(cell.v);
        const z = String(cell.z ?? '');
        if (z.includes('$')) style.numFmt = 'cop'; else if (z.includes('%')) style.numFmt = 'percent'; else if (/d.*m.*y|m.*d.*y|yy/i.test(z)) style.numFmt = 'date'; else if (/#,##0\.0/.test(z)) style.numFmt = 'number'; else if (/#,##0$/.test(z)) style.numFmt = 'integer';
        if (style.numFmt === 'cop' || style.numFmt === 'percent' || style.numFmt === 'number') { const m = z.match(/0\.(0+)/); style.decimals = m ? m[1].length : 0; }
        if (!input && !style.numFmt) continue;
        s.cells[key(r, c)] = { input, ...(style.numFmt ? { style } : {}) };
        if (r >= s.rowCount) s.rowCount = r + 50; if (c >= s.colCount) s.colCount = c + 5; }
      const cols = ws['!cols']; if (cols) cols.forEach((ci: any, i: number) => { if (ci?.wpx) s.colWidths[i] = ci.wpx; else if (ci?.wch) s.colWidths[i] = Math.round(ci.wch * 7 + 5); }); }
    sheets.push(s);
  }
  if (!sheets.length) return;
  mutate('Importar Excel', () => { wb = { sheets, activeSheetId: sheets[0].id, charts: [], macros: wb.macros }; selection = { sheetId: sheets[0].id, r1: 0, c1: 0, r2: 0, c2: 0 }; rebuildEngine(); });
}
function xlsxFmt(st: CellStyle): string | undefined {
  const d = (n: number) => (n > 0 ? '.' + '0'.repeat(n) : '');
  switch (st.numFmt) { case 'cop': return '"$" #,##0' + d(st.decimals ?? 2); case 'number': return '#,##0' + d(st.decimals ?? 2); case 'integer': return '#,##0'; case 'percent': return '0' + d(st.decimals ?? 0) + '%'; case 'date': return 'dd/mm/yyyy'; default: return undefined; }
}
function buildXlsxBook(): XLSX.WorkBook {
  const out = XLSX.utils.book_new();
  for (const s of wb.sheets) {
    const ws: XLSX.WorkSheet = {}; let mr = 0, mc = 0;
    for (const [k, cd] of Object.entries(s.cells)) { if (!cd.input) continue; const [r, c] = k.split(':').map(Number); mr = Math.max(mr, r); mc = Math.max(mc, c);
      const v = getValue(s.id, r, c); const cell: any = {};
      if (v && typeof v === 'object') { cell.t = 'e'; cell.v = 0x2a; cell.w = v.error; }
      else if (typeof v === 'number') { cell.t = 'n'; cell.v = v; }
      else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; }
      else { cell.t = 's'; cell.v = v ?? ''; }
      if (cd.input.startsWith('=')) cell.f = formulaToEnglish(cd.input);
      const z = xlsxFmt(cd.style ?? {}); if (z) cell.z = z;
      ws[XLSX.utils.encode_cell({ r, c })] = cell; }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } });
    const widths = Object.entries(s.colWidths); if (widths.length) { const cols: any[] = []; for (const [c, w] of widths) cols[Number(c)] = { wpx: w }; ws['!cols'] = cols; }
    XLSX.utils.book_append_sheet(out, ws, s.name.slice(0, 31));
  }
  return out;
}
/** Bytes del .xlsx (útil en Node / servidor). */
export function exportXlsxBuffer(): Uint8Array { return new Uint8Array(XLSX.write(buildXlsxBook(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer); }
export function exportXlsx(): Blob { return new Blob([exportXlsxBuffer() as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }

function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, ''); const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = count('\t') > 0 && count('\t') >= count(';') ? '\t' : count(';') >= count(',') && count(';') > 0 ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch; }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  if (sep === ',') for (const r of rows) for (let i = 0; i < r.length; i++) if (/^-?\d+\.\d+$/.test(r[i].trim())) r[i] = r[i].trim().replace('.', ',');
  return rows;
}
/** Importa un CSV a una hoja: si sheetName existe se reemplaza su contenido; si no, se crea (por defecto "Importado"). Queda activa. */
export function importCsv(text: string, sheetName?: string): void {
  const rows = parseCsv(text);
  mutate('Importar CSV', () => {
    let s = sheetName ? getSheetByName(sheetName) : undefined;
    if (!s) { s = newSheet(uniqueName(sheetName ?? 'Importado')); wb.sheets.push(s); }
    s.cells = {}; s.filter = null;
    rows.forEach((r, i) => r.forEach((v, j) => { if (v === '') return; const p = parseNumberEs(v); const fmt = p?.fmt ?? (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v.trim()) ? 'date' : undefined); s!.cells[key(i, j)] = { input: v, ...(fmt ? { style: { numFmt: fmt } } : {}) }; }));
    s.rowCount = Math.max(200, rows.length + 50); s.colCount = Math.max(26, ...rows.map(r => r.length + 2));
    wb.activeSheetId = s.id; selection = { sheetId: s.id, r1: 0, c1: 0, r2: 0, c2: 0 }; rebuildEngine();
  });
}
export function exportCsv(sheetId?: string): string {
  const s = getSheet(sheetId); const ur = usedRange(s.id); if (!ur) return '';
  const esc = (t: string) => (/[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
  const lines: string[] = [];
  for (let r = 0; r <= ur.r2; r++) { const cells: string[] = [];
    for (let c = 0; c <= ur.c2; c++) { const v = getValue(s.id, r, c); let t = '';
      if (v === null) t = ''; else if (typeof v === 'object') t = v.error; else if (typeof v === 'boolean') t = v ? 'VERDADERO' : 'FALSO';
      else if (typeof v === 'number') t = (getStyle(s.id, r, c).numFmt === 'date') ? formatNumber(v, 'date') : numberToInputEs(Number(v.toPrecision(15))); else t = String(v);
      cells.push(esc(t)); }
    lines.push(cells.join(';')); }
  return lines.join('\r\n');
}
export function replaceWorkbook(w: Workbook): void {
  mutate('Reemplazar libro', () => { wb = clone(w); wb.charts ??= []; wb.macros ??= []; if (!wb.sheets?.length) wb = defaultWorkbook(); if (!wb.sheets.find(s => s.id === wb.activeSheetId)) wb.activeSheetId = wb.sheets[0].id; selection = { sheetId: wb.activeSheetId, r1: 0, c1: 0, r2: 0, c2: 0 }; rebuildEngine(); });
}
export function resetWorkbook(): void { replaceWorkbook(defaultWorkbook()); }

/** Acceso directo al motor (depuración). */
export function getEngine(): HyperFormula { return hf; }

if (typeof window !== 'undefined') (window as any).__store = self;
