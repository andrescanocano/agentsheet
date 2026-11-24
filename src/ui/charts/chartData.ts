// Convierte un rango A1 del store en labels + series para Chart.js.
import * as S from '../../core/store';
import { parseRange } from '../../core/a1';
import type { CellValue } from '../../core/types';

export const PALETTE = ['#107c41', '#5b4bff', '#e8833a', '#2b8cbe', '#d6457a', '#8a9a1f', '#7a5195', '#00a3a3'];

export const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const fmtCOPShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return '$ ' + (n / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' mil M';
  if (a >= 1e6) return '$ ' + (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
  return fmtCOP.format(n);
};

function num(v: CellValue): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.replace(/[$\s.]/g, '').replace(',', '.');
    if (t !== '' && !isNaN(Number(t))) return Number(t);
  }
  return null;
}
const isText = (v: CellValue) => typeof v === 'string' && v.trim() !== '' && num(v) === null;
const label = (v: CellValue) => (v == null ? '' : typeof v === 'object' ? v.error : String(v));

export interface Series { labels: string[]; datasets: { label: string; data: (number | null)[] }[] }

export function readSeries(sheetId: string, range: string): Series {
  let g;
  try { g = parseRange(range); } catch { return { labels: [], datasets: [] }; }
  const v = (r: number, c: number) => S.getValue(sheetId, r, c);
  const isNum = (x: CellValue) => num(x) !== null && !(typeof x === 'string' && x.trim() === '');
  // Clasificar columnas mirando las filas de datos (desde la 2.ª si hay más de una fila)
  const probe0 = g.r2 > g.r1 ? g.r1 + 1 : g.r1;
  const numericCol: boolean[] = [];
  for (let c = g.c1; c <= g.c2; c++) {
    let n = 0, t = 0;
    for (let r = probe0; r <= g.r2; r++) { const x = v(r, c); if (isNum(x)) n++; else if (isText(x)) t++; }
    numericCol.push(n > 0 && n >= t * 3);
  }
  const dataCols: number[] = [];
  for (let c = g.c1; c <= g.c2; c++) if (numericCol[c - g.c1]) dataCols.push(c);
  let labelCol = -1;
  for (let c = g.c1; c <= g.c2; c++) if (!numericCol[c - g.c1]) { labelCol = c; break; }
  let hasHeader = false;
  if (g.r2 > g.r1) {
    for (const c of dataCols) if (isText(v(g.r1, c))) hasHeader = true;
  }
  const r0 = hasHeader ? g.r1 + 1 : g.r1;
  const labels: string[] = [];
  for (let r = r0; r <= g.r2; r++) labels.push(labelCol >= 0 ? label(v(r, labelCol)) : 'Fila ' + (r + 1));
  const datasets = dataCols.map((c, i) => {
    const data: (number | null)[] = [];
    for (let r = r0; r <= g.r2; r++) data.push(num(v(r, c)));
    return { label: hasHeader ? label(v(g.r1, c)) : 'Serie ' + (i + 1), data };
  });
  return { labels, datasets };
}
