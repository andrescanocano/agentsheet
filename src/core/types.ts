// CONTRATO COMPARTIDO — no cambiar firmas sin avisar al orquestador.
export type NumFmt = 'general' | 'number' | 'integer' | 'cop' | 'percent' | 'date';
export interface CellStyle {
  bold?: boolean; italic?: boolean; underline?: boolean;
  color?: string;            // color de texto CSS
  bg?: string;               // fondo CSS
  align?: 'left' | 'center' | 'right';
  border?: boolean;          // borde fino en los 4 lados
  numFmt?: NumFmt;
  decimals?: number;         // decimales para number/cop/percent (por defecto: number 2, cop 2, percent 0)
}
export interface CellData { input?: string; style?: CellStyle } // input crudo: "=SUMA(A1:A3)", "1234,5", "texto"
export type CellKey = string; // "r:c" base 0, ej. "0:0" = A1
export interface FilterState { r1: number; c1: number; r2: number; c2: number; col: number; hidden: string[] } // valores ocultos de la columna col
export interface SheetData {
  id: string; name: string;
  cells: Record<CellKey, CellData>;
  colWidths: Record<number, number>;   // px, por defecto 100
  rowCount: number; colCount: number;  // por defecto 200 x 26
  filter?: FilterState | null;
}
export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut';
export interface ChartData { id: string; sheetId: string; type: ChartType; range: string; title: string; x: number; y: number; w: number; h: number }
export interface Macro { id: string; name: string; code: string; description?: string }
export interface Workbook { sheets: SheetData[]; activeSheetId: string; charts: ChartData[]; macros: Macro[] }
export interface Selection { sheetId: string; r1: number; c1: number; r2: number; c2: number } // r1<=r2, c1<=c2 normalizado
export type CellValue = number | string | boolean | null | { error: string }; // error ej. "#N/A", "#DIV/0!", "#CICLO!"
export interface CellChange { r: number; c: number; input: string }   // input "" borra
