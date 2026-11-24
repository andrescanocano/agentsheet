// Agente de AgentsSheet: query() del Claude Agent SDK + MCP en proceso cuyas herramientas
// reenvían cada operación al navegador (fuente de verdad del libro) por WebSocket.
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Nunca usar una llave de API por accidente: el agente corre con la sesión local de `claude` (plan del usuario).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLAUDE_BIN: string = resolveClaude();
function resolveClaude(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  try { const p = execSync('which claude', { encoding: 'utf8' }).trim(); if (p && existsSync(p)) return p; } catch { /* no está en el PATH */ }
  return 'claude';
}
export const WEB_ORIGIN = process.env.AGENTSHEET_WEB ?? 'http://localhost:5173';

export const PRODUCTOS_DEMO = [
  'Portátil Lenovo ThinkPad', 'Monitor Dell 24 pulgadas', 'Mouse inalámbrico Logitech', 'Teclado Logitech K120',
  'Impresora HP LaserJet', 'Silla ergonómica', 'Escritorio en L', 'Disco SSD 1 TB', 'Memoria USB 64 GB', 'Audífonos Jabra',
  'Cámara web Logitech C920', 'Router TP-Link', 'Tóner HP 85A', 'Resma papel carta', 'Tablet Samsung Galaxy Tab',
  'Celular Samsung Galaxy A55', 'Proyector Epson', 'Base refrigerante para portátil', 'Cable HDMI 2 m', 'UPS APC 1500 VA',
];

function macroApiDoc(): string {
  const p = path.join(ROOT, 'src/ui/macros/API.md');
  if (existsSync(p)) return readFileSync(p, 'utf8').slice(0, 6000);
  return 'Objetos globales: `libro.hoja("Ventas")` (o `hoja` = hoja activa), `hoja.rango("A1:B3").valores` (matriz, lectura/escritura), `hoja.rango("A1:B3").formato({bg:"#ffeb9c", bold:true})`, `hoja.celda("A1").valor`, `hoja.usado()` (rango usado), `log(...)` para mensajes.';
}

export function systemPrompt(): string {
  return `Eres el agente de AgentsSheet, una hoja de cálculo web en español de Colombia. Operas la hoja SOLO con tus herramientas (mcp__sheet__*): nunca inventes que hiciste algo sin llamarlas.

Reglas:
- Idioma: español de Colombia. Respuestas finales breves en markdown (negritas, listas cortas).
- Fórmulas en ESPAÑOL con separador ';' y coma decimal: SUMA, PROMEDIO, CONTAR, CONTARA, MAX, MIN, SI, Y, O, SUMAR.SI, CONTAR.SI, PROMEDIO.SI, BUSCARV(valor;rango;col;FALSO), BUSCARX, REDONDEAR, SI.ERROR. Ejemplo: =SUMA(B2:B21), =BUSCARV(A2;Precios!A:C;2;FALSO), =D2*0,19.
- Prefiere FÓRMULAS sobre valores calculados para totales, IVA, márgenes y resúmenes (para que la hoja quede viva).
- Números en write_range: pásalos como número JSON (1234.5) o texto con coma decimal ("1234,5"); sin separador de miles.
- Formato de pesos: set_format con numFmt "cop" (decimals 0). Porcentajes: numFmt "percent".
- Encabezados en negrita con fondo (p. ej. bg "#1f4e78" y color "#ffffff"), bordes en tablas, ancho de columnas legible.
- Trabaja en pasos visibles: primero select_range donde vas a trabajar, luego escribe por bloques, luego formato, luego gráficos.
- Antes de modificar datos existentes, léelos (get_workbook_overview / read_range).
- Para datos de una URL (CSV/JSON) usa fetch_url; URLs relativas como /demo/precios.csv son válidas. Para cruzarlos, crea una hoja aparte (p. ej. "Precios") y usa BUSCARV/BUSCARX con ;FALSO.
- Para tablas de ejemplo de productos usa preferiblemente estos 20 productos (coinciden con /demo/precios.csv): ${PRODUCTOS_DEMO.join('; ')}. Regiones sugeridas: Antioquia, Bogotá, Valle, Atlántico, Santander.
- Tablas de ventas de ejemplo: formato largo, una fila por venta (Producto | Región | Unidades | Precio unitario | Total =C2*D2), y un resumen por región aparte con SUMAR.SI (=SUMAR.SI($B$2:$B$21;G2;$E$2:$E$21)) y total con SUMA. Escribe cada bloque en UNA sola llamada write_range y aplica formatos en pocas llamadas: sé rápido (pocos pasos).
- Gráficos: create_chart con un rango cuya primera columna son etiquetas y las demás series, con encabezados en la primera fila.
- Macros (JavaScript que corre en el navegador): save_macro y run_macro. API de macros:
${macroApiDoc()}
- Al terminar, deja activa la hoja donde está el resultado principal (activate_sheet) para que el usuario lo vea.
- Si el usuario rechaza un paso, no insistas: explica y propone una alternativa.`;
}

// ---------- puente con el navegador ----------
export interface Bridge {
  op(name: string, args: unknown): Promise<unknown>;               // ejecuta en el navegador
  emit(ev: Record<string, unknown>): void;                         // evento al chat
  approve(summary: string): Promise<boolean>;                      // aprobación en modo Preguntar
  mode: 'ask' | 'auto';
}

const sheetArg = z.string().optional().describe('Nombre de la hoja (opcional; por defecto la activa)');
const rangeArg = z.string().describe('Rango en notación A1, p. ej. "A1:D20" o "B2"');
const styleShape = {
  bold: z.boolean().optional(), italic: z.boolean().optional(), color: z.string().optional().describe('Color de texto CSS'),
  bg: z.string().optional().describe('Color de fondo CSS'), align: z.enum(['left', 'center', 'right']).optional(),
  border: z.boolean().optional(), numFmt: z.enum(['general', 'number', 'integer', 'cop', 'percent', 'date']).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
};
const chartNames: Record<string, string> = { bar: 'barras', line: 'líneas', pie: 'torta', doughnut: 'dona' };

type Def = { name: string; desc: string; shape: Record<string, z.ZodTypeAny>; mutates: boolean; summary: (a: any) => string; server?: (a: any) => Promise<unknown> };

const DEFS: Def[] = [
  { name: 'get_workbook_overview', desc: 'Resumen del libro: hojas con su rango usado, hoja activa, selección, gráficos y macros.', shape: {}, mutates: false, summary: () => 'Revisando el libro' },
  { name: 'read_range', desc: 'Lee un rango: devuelve matriz de inputs (fórmulas) y de valores mostrados. Máximo 400 celdas.', shape: { range: rangeArg, sheet: sheetArg }, mutates: false, summary: a => `Leyendo ${a.range}` },
  { name: 'write_range', desc: 'Escribe una matriz de valores o fórmulas (en español con ;) desde la celda inicial. Cada fila es un arreglo. "" borra.', shape: { start: z.string().describe('Celda inicial, p. ej. "A1"'), values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('Matriz fila por fila'), sheet: sheetArg }, mutates: true, summary: a => `Escribiendo ${a.start}${dims(a.values, a.start)}` },
  { name: 'set_format', desc: 'Aplica estilo a un rango: negrita, colores, alineación, borde, formato numérico (cop, percent, number, integer, date) y decimales.', shape: { range: rangeArg, sheet: sheetArg, ...styleShape }, mutates: true, summary: a => a.numFmt === 'cop' ? `Aplicando formato COP a ${a.range}` : `Dando formato a ${a.range}${fmtDesc(a)}` },
  { name: 'clear_range', desc: 'Borra un rango (what: all | contents | formats).', shape: { range: rangeArg, sheet: sheetArg, what: z.enum(['all', 'contents', 'formats']).optional() }, mutates: true, summary: a => `Borrando ${a.range}` },
  { name: 'create_sheet', desc: 'Crea una hoja nueva con ese nombre y la activa.', shape: { name: z.string() }, mutates: true, summary: a => `Creando la hoja ${a.name}` },
  { name: 'rename_sheet', desc: 'Cambia el nombre de una hoja.', shape: { sheet: z.string().describe('Nombre actual'), name: z.string().describe('Nombre nuevo') }, mutates: true, summary: a => `Renombrando ${a.sheet} a ${a.name}` },
  { name: 'activate_sheet', desc: 'Activa (muestra) una hoja por nombre.', shape: { sheet: z.string() }, mutates: false, summary: a => `Abriendo la hoja ${a.sheet}` },
  { name: 'select_range', desc: 'Selecciona un rango para mostrarle al usuario dónde trabajas.', shape: { range: rangeArg, sheet: sheetArg }, mutates: false, summary: a => `Seleccionando ${a.range}` },
  { name: 'sort_range', desc: 'Ordena un rango por una columna (letra). hasHeader: la primera fila es encabezado.', shape: { range: rangeArg, column: z.string().describe('Letra de la columna, p. ej. "E"'), ascending: z.boolean().optional(), hasHeader: z.boolean().optional(), sheet: sheetArg }, mutates: true, summary: a => `Ordenando ${a.range} por ${a.column}` },
  { name: 'set_filter', desc: 'Pone un filtro en un rango con encabezado: oculta las filas cuyo valor en la columna (letra) esté en hide, o muestra solo las de show.', shape: { range: rangeArg, column: z.string(), hide: z.array(z.string()).optional(), show: z.array(z.string()).optional(), sheet: sheetArg }, mutates: true, summary: a => `Filtrando ${a.range} por ${a.column}` },
  { name: 'clear_filter', desc: 'Quita el filtro de la hoja.', shape: { sheet: sheetArg }, mutates: true, summary: () => 'Quitando el filtro' },
  { name: 'set_col_width', desc: 'Ancho de columnas en px. columns: letras, p. ej. ["A","B"].', shape: { columns: z.array(z.string()), width: z.number(), sheet: sheetArg }, mutates: true, summary: a => `Ajustando ancho de ${a.columns.join(', ')}` },
  { name: 'create_chart', desc: 'Crea un gráfico (bar, line, pie, doughnut). Rango con encabezados: primera columna etiquetas, demás series.', shape: { type: z.enum(['bar', 'line', 'pie', 'doughnut']), range: rangeArg, title: z.string(), sheet: sheetArg }, mutates: true, summary: a => `Creando gráfico de ${chartNames[a.type] ?? a.type}` },
  { name: 'fetch_url', desc: 'Descarga el texto de una URL (CSV, JSON, texto) desde el servidor. Acepta rutas relativas como /demo/precios.csv. Trunca a 20.000 caracteres.', shape: { url: z.string() }, mutates: false, summary: a => `Trayendo ${a.url}`, server: async a => fetchUrl(a.url) },
  { name: 'save_macro', desc: 'Guarda una macro JavaScript (usa la API de macros) con nombre y descripción.', shape: { name: z.string(), code: z.string(), description: z.string().optional() }, mutates: true, summary: a => `Guardando la macro ${a.name}` },
  { name: 'run_macro', desc: 'Ejecuta una macro guardada por nombre (o código suelto en code) en el navegador. Devuelve log y errores.', shape: { name: z.string().optional(), code: z.string().optional() }, mutates: true, summary: a => `Ejecutando la macro ${a.name ?? '(código)'}` },
  { name: 'explain_cell', desc: 'Explica una celda: input, valor y valores de sus precedentes.', shape: { cell: z.string(), sheet: sheetArg }, mutates: false, summary: a => `Analizando ${a.cell}` },
];

function fmtDesc(a: any): string {
  const p: string[] = [];
  if (a.bold) p.push('negrita'); if (a.italic) p.push('cursiva'); if (a.color) p.push(`texto ${a.color}`); if (a.bg) p.push(`fondo ${a.bg}`);
  if (a.border) p.push('bordes'); if (a.align) p.push(`alineado ${a.align === 'left' ? 'a la izquierda' : a.align === 'right' ? 'a la derecha' : 'al centro'}`);
  if (a.numFmt && a.numFmt !== 'cop') p.push(`formato ${a.numFmt}`);
  return p.length ? ` (${p.join(', ')})` : '';
}
function dims(values: unknown[][], start: string): string {
  try {
    const m = /^([A-Za-z]+)(\d+)$/.exec(start.trim()); if (!m || !values?.length) return '';
    let c = 0; for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    const cols = Math.max(...values.map(r => r.length)); let n = c + cols - 1, s = '';
    while (n > 0) { const k = (n - 1) % 26; s = String.fromCharCode(65 + k) + s; n = Math.floor((n - 1) / 26); }
    const r2 = parseInt(m[2], 10) + values.length - 1;
    return values.length === 1 && cols === 1 ? '' : `:${s}${r2}`;
  } catch { return ''; }
}

async function fetchUrl(url: string): Promise<unknown> {
  const full = /^https?:\/\//i.test(url) ? url : new URL(url, WEB_ORIGIN).toString();
  const res = await fetch(full, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  return { url: full, status: res.status, contentType: res.headers.get('content-type'), truncated: text.length > 20000, text: text.slice(0, 20000) };
}

const ok = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v) }] });
const fail = (m: string) => ({ content: [{ type: 'text' as const, text: m }], isError: true });

export function buildMcp(bridge: Bridge) {
  let seq = 0;
  const tools = DEFS.map(d => tool(d.name, d.desc, d.shape, async (args: any) => {
    const id = `t${++seq}`; const label = d.summary(args);
    if (d.mutates && bridge.mode === 'ask') {
      const yes = await bridge.approve(label);
      if (!yes) { bridge.emit({ type: 'tool', id, label, status: 'rejected' }); return ok(`El usuario rechazó este paso (${label}). No lo repitas sin preguntar.`); }
    }
    bridge.emit({ type: 'tool', id, label, status: 'running' });
    try {
      const result = d.server ? await d.server(args) : await bridge.op(d.name, args);
      const r = result as any;
      if (r && typeof r === 'object' && r.error) { bridge.emit({ type: 'tool', id, label, status: 'error', detail: String(r.error) }); return fail(String(r.error)); }
      bridge.emit({ type: 'tool', id, label, status: 'done' });
      return ok(result ?? 'ok');
    } catch (e: any) {
      bridge.emit({ type: 'tool', id, label, status: 'error', detail: String(e?.message ?? e) });
      return fail('Error: ' + String(e?.message ?? e));
    }
  }));
  return createSdkMcpServer({ name: 'sheet', version: '1.0.0', tools });
}

export const ALLOWED = DEFS.map(d => `mcp__sheet__${d.name}`);

export function runAgent(opts: { prompt: string; model: string; resume?: string; bridge: Bridge }) {
  return query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      systemPrompt: systemPrompt(),
      mcpServers: { sheet: buildMcp(opts.bridge) },
      tools: [],                    // sin herramientas integradas (Bash, Write, Edit, WebFetch...)
      allowedTools: ALLOWED,
      disallowedTools: ['Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit'],
      permissionMode: 'dontAsk',
      settingSources: [],
      includePartialMessages: true,
      maxTurns: 40,
      cwd: ROOT,
      resume: opts.resume || undefined,
      pathToClaudeCodeExecutable: CLAUDE_BIN,
      env: cleanEnv(),
    },
  });
}

// Entorno del CLI hijo: sin llaves y sin variables del host de escritorio (que cambian cómo se autentica).
export function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN') continue;
    if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k.startsWith('CLAUDE_AGENT_SDK') || k === 'CLAUDE_PID') continue;
    out[k] = v;
  }
  return out;
}

export async function suggest(context: string): Promise<{ titulo: string; prompt: string }[]> {
  const q = query({
    prompt: `Esta es una hoja de cálculo del usuario:\n\n${context.slice(0, 8000)}\n\nPropón exactamente 3 acciones útiles y concretas que un agente de hoja de cálculo podría hacer ahora con estos datos (totales con fórmulas, formato COP, gráfico, resumen por categoría, detectar duplicados, etc.). Responde SOLO JSON válido: [{"titulo":"máx 5 palabras","prompt":"instrucción completa en español para el agente"}]`,
    options: { model: 'claude-sonnet-5-5', tools: [], maxTurns: 1, settingSources: [], systemPrompt: 'Respondes solo JSON válido, en español de Colombia.', pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(), persistSession: false } as any,
  });
  let text = '';
  for await (const m of q) if (m.type === 'result' && m.subtype === 'success') text = m.result;
  const j = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  const arr = JSON.parse(j);
  return (Array.isArray(arr) ? arr : []).slice(0, 3).filter((s: any) => s?.titulo && s?.prompt);
}
