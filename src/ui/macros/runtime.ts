// Runtime de macros: JavaScript sobre una API sencilla en español (ver API.md).
import * as S from '../../core/store';
import { parseRange, rangeToA1, toA1, colToLetters, lettersToCol, parseA1 } from '../../core/a1';
import type { CellStyle, CellValue, CellChange, NumFmt } from '../../core/types';

type Box = { r1: number; c1: number; r2: number; c2: number };
export interface Estilo {
  bold?: boolean; italic?: boolean; underline?: boolean; color?: string; bg?: string;
  align?: 'left' | 'center' | 'right'; border?: boolean; numFmt?: NumFmt; decimals?: number;
}

function toInput(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
function plain(v: CellValue): number | string | boolean | null {
  return v !== null && typeof v === 'object' ? v.error : v;
}
function estilo(e: Estilo): Partial<CellStyle> {
  const out: Partial<CellStyle> = {};
  for (const k of ['bold', 'italic', 'underline', 'color', 'bg', 'align', 'border', 'numFmt', 'decimals'] as const)
    if (e[k] !== undefined) (out as any)[k] = e[k];
  return out;
}

class Celda {
  constructor(private sid: string, readonly r: number, readonly c: number, private buf?: CellChange[]) {}
  get fila() { return this.r + 1; }
  get col() { return colToLetters(this.c); }
  get direccion() { return toA1(this.r, this.c); }
  get valor() { return plain(S.getValue(this.sid, this.r, this.c)); }
  set valor(v: unknown) { this.write(toInput(v)); }
  get formula() { return S.getInput(this.sid, this.r, this.c); }
  set formula(f: string) { this.write(String(f ?? '')); }
  get texto() { return S.getDisplay(this.sid, this.r, this.c); }
  formato(e: Estilo) { S.setStyle(this.sid, { r1: this.r, c1: this.c, r2: this.r, c2: this.c }, estilo(e)); return this; }
  limpiar() { S.clearRange(this.sid, { r1: this.r, c1: this.c, r2: this.r, c2: this.c }, 'all'); return this; }
  private write(input: string) {
    if (this.buf) this.buf.push({ r: this.r, c: this.c, input });
    else S.setInputs(this.sid, [{ r: this.r, c: this.c, input }]);
  }
  toString() { return this.direccion; }
}

class Rango {
  constructor(private sid: string, readonly b: Box) {}
  get direccion() { return rangeToA1(this.b); }
  get filas() { return this.b.r2 - this.b.r1 + 1; }
  get columnas() { return this.b.c2 - this.b.c1 + 1; }
  private matrix<T>(f: (r: number, c: number) => T): T[][] {
    const out: T[][] = [];
    for (let r = this.b.r1; r <= this.b.r2; r++) { const row: T[] = []; for (let c = this.b.c1; c <= this.b.c2; c++) row.push(f(r, c)); out.push(row); }
    return out;
  }
  get valores() { return this.matrix((r, c) => plain(S.getValue(this.sid, r, c))); }
  set valores(m: unknown[][]) { this.writeMatrix(m, toInput); }
  get formulas() { return this.matrix((r, c) => S.getInput(this.sid, r, c)); }
  set formulas(m: unknown[][]) { this.writeMatrix(m, v => String(v ?? '')); }
  private writeMatrix(m: unknown[][], conv: (v: unknown) => string) {
    if (!Array.isArray(m)) throw new Error('Se esperaba una matriz, ej. [[1, 2], [3, 4]]');
    const ch: CellChange[] = [];
    m.forEach((row, i) => (Array.isArray(row) ? row : [row]).forEach((v, j) => ch.push({ r: this.b.r1 + i, c: this.b.c1 + j, input: conv(v) })));
    if (ch.length) S.setInputs(this.sid, ch);
  }
  celda(i: number, j: number) { return new Celda(this.sid, this.b.r1 + i, this.b.c1 + j); } // relativa, base 0
  formato(e: Estilo) { S.setStyle(this.sid, this.b, estilo(e)); return this; }
  limpiar(que: 'all' | 'contents' | 'formats' = 'all') { S.clearRange(this.sid, this.b, que); return this; }
  cadaCelda(fn: (celda: Celda) => void) {
    const buf: CellChange[] = [];
    for (let r = this.b.r1; r <= this.b.r2; r++) for (let c = this.b.c1; c <= this.b.c2; c++) fn(new Celda(this.sid, r, c, buf));
    if (buf.length) S.setInputs(this.sid, buf);
    return this;
  }
  toString() { return this.direccion; }
}

class Hoja {
  constructor(readonly id: string) {}
  get nombre() { return S.getSheet(this.id).name; }
  rango(a1: string) { return new Rango(this.id, parseRange(a1)); }
  celda(a1: string) { const p = parseA1(a1); return new Celda(this.id, p.r, p.c); }
  usado() { return new Rango(this.id, S.usedRange(this.id) ?? { r1: 0, c1: 0, r2: 0, c2: 0 }); }
  buscar(texto: string, max = 50) {
    const u = S.usedRange(this.id); const out: Celda[] = []; if (!u) return out;
    const t = String(texto).toLowerCase();
    for (let r = u.r1; r <= u.r2 && out.length < max; r++) for (let c = u.c1; c <= u.c2 && out.length < max; c++) {
      const s = (S.getDisplay(this.id, r, c) + '\u0000' + S.getInput(this.id, r, c)).toLowerCase();
      if (s.includes(t)) out.push(new Celda(this.id, r, c));
    }
    return out;
  }
  ordenar(a1: string, colLetra: string, asc = true, conEncabezado?: boolean) {
    const b = parseRange(a1); const col = lettersToCol(colLetra);
    if (col < b.c1 || col > b.c2) throw new Error(`La columna ${colLetra} no está dentro de ${a1}`);
    const head = conEncabezado ?? (() => { const v = S.getValue(this.id, b.r1, col); return typeof v === 'string' && isNaN(Number(v.replace(',', '.'))); })();
    S.sortRange(this.id, b, col, asc, head);
    return this;
  }
  activar() { S.setActiveSheet(this.id); return this; }
  toString() { return this.nombre; }
}

function makeLibro() {
  return {
    hoja(nombre?: string) {
      if (!nombre) return new Hoja(S.getSheet().id);
      const sh = S.getSheetByName(nombre);
      if (!sh) throw new Error(`No existe la hoja "${nombre}". Hojas: ${S.getWorkbook().sheets.map(s => s.name).join(', ')}`);
      return new Hoja(sh.id);
    },
    hojas() { return S.getWorkbook().sheets.map(s => s.name); },
    agregarHoja(nombre: string) { return new Hoja(S.addSheet(nombre).id); },
  };
}

function fmtArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Celda || a instanceof Rango || a instanceof Hoja) return String(a);
  try { return JSON.stringify(a); } catch { return String(a); }
}

export interface MacroResult { ok: boolean; log: string[]; error?: string }

export function runMacroCode(code: string, label = 'Macro'): MacroResult {
  const log: string[] = [];
  const logFn = (...args: unknown[]) => { log.push(args.map(fmtArg).join(' ')); };
  const alerta = (msg: unknown) => { log.push('⚠ ' + fmtArg(msg)); };
  const libro = makeLibro();
  let fn: Function;
  try { fn = new Function('libro', 'hoja', 'log', 'alerta', '"use strict";\n' + code); }
  catch (e: any) { return { ok: false, log, error: 'Error de sintaxis: ' + (e?.message ?? e) }; }
  S.beginTransaction(label);
  try {
    const r = fn(libro, libro.hoja(), logFn, alerta);
    if (r && typeof (r as any).then === 'function') log.push('(La macro devolvió una promesa: las macros corren de forma síncrona.)');
    return { ok: true, log };
  } catch (e: any) {
    return { ok: false, log, error: e?.message ?? String(e) };
  } finally {
    S.commitTransaction();
  }
}

export function runMacro(idOrName: string): MacroResult {
  const ms = S.getWorkbook().macros;
  const m = ms.find(x => x.id === idOrName) ?? ms.find(x => x.name.toLowerCase() === String(idOrName).toLowerCase());
  if (!m) return { ok: false, log: [], error: `No existe la macro "${idOrName}". Disponibles: ${ms.map(x => x.name).join(', ') || '(ninguna)'}` };
  return runMacroCode(m.code, 'Macro: ' + m.name);
}

export const EXAMPLE_MACRO = {
  name: 'ResaltarTotalesMayores',
  description: 'Resalta en amarillo y negrita los valores > $ 1.000.000 de la columna cuyo encabezado contiene "Total".',
  code: `// Resalta en amarillo los totales mayores a $ 1.000.000
const area = hoja.usado();
const valores = area.valores;
const col = valores[0].findIndex(v => String(v ?? '').toLowerCase().includes('total'));
if (col < 0) {
  alerta('No encontré una columna con "Total" en el encabezado.');
  return;
}
let n = 0;
for (let i = 1; i < valores.length; i++) {
  const v = valores[i][col];
  if (typeof v === 'number' && v > 1000000) {
    area.celda(i, col).formato({ bg: '#ffeb9c', bold: true });
    n++;
  }
}
log('Celdas resaltadas:', n, 'en la columna', area.celda(0, col).col);
`,
};

export const NEW_MACRO_TEMPLATE = `// Nueva macro. API: libro, hoja (activa), log(...), alerta(msg). Ver API.md
const area = hoja.usado();
log('Área usada:', area.direccion);
`;

// Para el agente IA y para depurar desde la consola.
(globalThis as any).__macros = { runMacroCode, runMacro, EXAMPLE_MACRO };
