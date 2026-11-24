/// <reference types="vite/client" />
// Ejecuta en el navegador (contra el store) las operaciones que pide el agente.
import * as S from '../core/store';
import { parseRange, parseA1, rangeToA1, toA1, lettersToCol } from '../core/a1';
import type { CellChange, SheetData } from '../core/types';

const macroRuntime = import.meta.glob('../ui/macros/runtime.ts');

function sheetOf(name?: string): SheetData {
  if (!name) return S.getSheet();
  const s = S.getSheetByName(name) ?? S.getWorkbook().sheets.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new Error(`No existe la hoja "${name}". Hojas: ${S.getWorkbook().sheets.map(x => x.name).join(', ')}`);
  return s;
}
function rng(a: string) { return parseRange(a.replace(/^.*!/, '').replace(/\$/g, '')); }
function toInput(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  return String(v);
}

export function buildContext(): string {
  const wb = S.getWorkbook(); const sh = S.getSheet(); const sel = S.getSelection();
  const used = S.usedRange(sh.id);
  const lines: string[] = [];
  lines.push(`Hojas: ${wb.sheets.map(s => s.name).join(', ')}. Hoja activa: ${sh.name}.`);
  const selA1 = rangeToA1(sel);
  const selCells = (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1);
  lines.push(`Selección: ${selA1}${selCells <= 40 ? ' = ' + JSON.stringify(matrix(sel, (r, c) => S.getDisplay(sh.id, r, c))) : ` (${selCells} celdas)`}`);
  if (!used) { lines.push('La hoja activa está vacía.'); return lines.join('\n'); }
  lines.push(`Rango usado: ${rangeToA1(used)}.`);
  const r2 = Math.min(used.r2, used.r1 + 29), c2 = Math.min(used.c2, used.c1 + 25);
  lines.push(`Primeras filas (TSV con fórmulas, desde ${toA1(used.r1, used.c1)}):`);
  for (let r = used.r1; r <= r2; r++) {
    const row: string[] = [];
    for (let c = used.c1; c <= c2; c++) row.push(S.getInput(sh.id, r, c));
    lines.push(`${r + 1}\t${row.join('\t')}`);
  }
  if (wb.charts.length) lines.push(`Gráficos: ${wb.charts.map(c => `${c.title} (${c.type}, ${c.range})`).join('; ')}`);
  if (wb.macros.length) lines.push(`Macros: ${wb.macros.map(m => m.name).join(', ')}`);
  return lines.join('\n');
}

function matrix<T>(s: { r1: number; c1: number; r2: number; c2: number }, f: (r: number, c: number) => T): T[][] {
  const out: T[][] = [];
  for (let r = s.r1; r <= s.r2; r++) { const row: T[] = []; for (let c = s.c1; c <= s.c2; c++) row.push(f(r, c)); out.push(row); }
  return out;
}

export async function runOp(name: string, a: any): Promise<unknown> {
  try { return await exec(name, a ?? {}); }
  catch (e: any) { return { error: String(e?.message ?? e) }; }
}

async function exec(name: string, a: any): Promise<unknown> {
  switch (name) {
    case 'get_workbook_overview': {
      const wb = S.getWorkbook();
      return {
        activeSheet: S.getSheet().name,
        selection: rangeToA1(S.getSelection()),
        sheets: wb.sheets.map(s => { const u = S.usedRange(s.id); return { name: s.name, usedRange: u ? rangeToA1(u) : null, filter: s.filter ? true : false }; }),
        charts: wb.charts.map(c => ({ title: c.title, type: c.type, range: c.range, sheet: wb.sheets.find(s => s.id === c.sheetId)?.name })),
        macros: wb.macros.map(m => ({ name: m.name, description: m.description })),
      };
    }
    case 'read_range': {
      const sh = sheetOf(a.sheet); const s = rng(a.range);
      const cells = (s.r2 - s.r1 + 1) * (s.c2 - s.c1 + 1);
      let t = s; let truncated = false;
      if (cells > 400) { const cols = s.c2 - s.c1 + 1; t = { ...s, r2: s.r1 + Math.max(0, Math.floor(400 / cols) - 1), c2: s.c1 + Math.min(cols, 400) - 1 }; truncated = true; }
      return { sheet: sh.name, range: rangeToA1(t), truncated, inputs: matrix(t, (r, c) => S.getInput(sh.id, r, c)), values: matrix(t, (r, c) => S.getDisplay(sh.id, r, c)) };
    }
    case 'write_range': {
      const sh = sheetOf(a.sheet); const p = parseA1(String(a.start).replace(/\$/g, ''));
      const changes: CellChange[] = [];
      (a.values as unknown[][]).forEach((row, i) => (row ?? []).forEach((v, j) => changes.push({ r: p.r + i, c: p.c + j, input: toInput(v) })));
      S.setInputs(sh.id, changes);
      const rows = a.values.length, cols = Math.max(1, ...a.values.map((r: unknown[]) => r.length));
      const area = { r1: p.r, c1: p.c, r2: p.r + rows - 1, c2: p.c + cols - 1 };
      S.setSelection({ sheetId: sh.id, ...area });
      const errs: string[] = [];
      for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) { const v = S.getValue(sh.id, r, c); if (v && typeof v === 'object' && 'error' in v) errs.push(`${toA1(r, c)}=${v.error}`); }
      return { written: rangeToA1(area), cells: changes.length, errors: errs.slice(0, 20) };
    }
    case 'set_format': {
      const sh = sheetOf(a.sheet); const { range, sheet, ...style } = a;
      S.setStyle(sh.id, rng(range), style); return { formatted: range };
    }
    case 'clear_range': { const sh = sheetOf(a.sheet); S.clearRange(sh.id, rng(a.range), a.what ?? 'all'); return { cleared: a.range }; }
    case 'create_sheet': { const s = S.addSheet(a.name); S.setActiveSheet(s.id); return { created: s.name }; }
    case 'rename_sheet': { const sh = sheetOf(a.sheet); S.renameSheet(sh.id, a.name); return { renamed: a.name }; }
    case 'activate_sheet': { const sh = sheetOf(a.sheet); S.setActiveSheet(sh.id); return { active: sh.name }; }
    case 'select_range': {
      const sh = sheetOf(a.sheet); if (S.getSheet().id !== sh.id) S.setActiveSheet(sh.id);
      S.setSelection({ sheetId: sh.id, ...rng(a.range) }); return { selected: a.range };
    }
    case 'sort_range': { const sh = sheetOf(a.sheet); S.sortRange(sh.id, rng(a.range), lettersToCol(a.column), a.ascending !== false, a.hasHeader !== false); return { sorted: a.range }; }
    case 'set_filter': {
      const sh = sheetOf(a.sheet); const s = rng(a.range); const col = lettersToCol(a.column);
      let hidden: string[] = a.hide ?? [];
      if (a.show?.length) {
        const all = new Set<string>(); for (let r = s.r1 + 1; r <= s.r2; r++) all.add(S.getDisplay(sh.id, r, col));
        hidden = [...all].filter(v => !a.show.includes(v));
      }
      S.setFilter(sh.id, { ...s, col, hidden }); return { filtered: a.range, hidden };
    }
    case 'clear_filter': { const sh = sheetOf(a.sheet); S.setFilter(sh.id, null); return { cleared: true }; }
    case 'set_col_width': { const sh = sheetOf(a.sheet); for (const l of a.columns) S.setColWidth(sh.id, lettersToCol(l), a.width); return { ok: true }; }
    case 'create_chart': {
      const sh = sheetOf(a.sheet); const n = S.getWorkbook().charts.filter(c => c.sheetId === sh.id).length;
      const u = S.usedRange(sh.id); let x = 50; for (let c = 0; c <= (u?.c2 ?? 4); c++) x += sh.colWidths[c] ?? 100;
      const ch = S.addChart({ sheetId: sh.id, type: a.type, range: a.range, title: a.title, x: Math.min(x + 20, Math.max(60, (document.querySelector('.grid-area')?.clientWidth ?? 1100) - 480)), y: 30 + n * 320, w: 460, h: 300 });
      return { created: ch.id, title: ch.title };
    }
    case 'save_macro': { const m = S.saveMacro({ name: a.name, code: a.code, description: a.description }); return { saved: m.name, id: m.id }; }
    case 'run_macro': {
      const loader = macroRuntime['../ui/macros/runtime.ts'];
      if (!loader) return { error: 'El runtime de macros todavía no existe (src/ui/macros/runtime.ts).' };
      const rt: any = await loader();
      if (a.code) return rt.runMacroCode(a.code);
      const m = S.getWorkbook().macros.find(x => x.name.toLowerCase() === String(a.name ?? '').toLowerCase());
      if (!m) return { error: `No existe la macro "${a.name}".` };
      return rt.runMacro ? rt.runMacro(m.id) : rt.runMacroCode(m.code);
    }
    case 'explain_cell': {
      const sh = sheetOf(a.sheet); const p = parseA1(String(a.cell).replace(/\$/g, ''));
      const input = S.getInput(sh.id, p.r, p.c);
      const precedents: Record<string, string> = {};
      const refs = input.startsWith('=') ? input.match(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g) ?? [] : [];
      let count = 0;
      for (const ref of refs) {
        const s = rng(ref);
        for (let r = s.r1; r <= s.r2 && count < 60; r++) for (let c = s.c1; c <= s.c2 && count < 60; c++, count++) precedents[toA1(r, c)] = S.getDisplay(sh.id, r, c);
      }
      let dependents: string[] = []; try { dependents = S.getDependents(sh.id, p.r, p.c); } catch { /* opcional */ }
      return { cell: a.cell, input, value: S.getValue(sh.id, p.r, p.c), display: S.getDisplay(sh.id, p.r, p.c), precedents, dependents };
    }
    default: return { error: `Operación desconocida: ${name}` };
  }
}
