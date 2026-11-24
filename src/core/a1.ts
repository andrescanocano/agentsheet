// Utilidades A1 (contrato; Core puede mejorar sin cambiar firmas)
export function colToLetters(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
export function lettersToCol(s: string): number { let c = 0; for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; }
export function toA1(r: number, c: number): string { return colToLetters(c) + (r + 1); }
export function parseA1(a: string): { r: number; c: number } { const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a.trim()); if (!m) throw new Error('Referencia inválida: ' + a); return { r: parseInt(m[2], 10) - 1, c: lettersToCol(m[1]) }; }
export function parseRange(a: string): { r1: number; c1: number; r2: number; c2: number } { const [x, y] = a.split(':'); const p = parseA1(x); const q = y ? parseA1(y) : p; return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) }; }
export function rangeToA1(s: { r1: number; c1: number; r2: number; c2: number }): string { const a = toA1(s.r1, s.c1), b = toA1(s.r2, s.c2); return a === b ? a : a + ':' + b; }
export const key = (r: number, c: number) => r + ':' + c;
