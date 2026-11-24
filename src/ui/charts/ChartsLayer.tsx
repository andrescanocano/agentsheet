// Capa de gráficos flotantes encima del grid + botón "Gráfico" en el toolbar.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Chart, BarController, BarElement, LineController, LineElement, PointElement, PieController, DoughnutController,
  ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from 'chart.js';
import * as S from '../../core/store';
import { rangeToA1 } from '../../core/a1';
import type { ChartData, ChartType } from '../../core/types';
import { readSeries, PALETTE, fmtValue, fmtAxis } from './chartData';
import { useToolbarSlot } from './toolbarSlot';
import './charts.css';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, PieController, DoughnutController,
  ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);
Chart.defaults.font.family = "'Segoe UI', system-ui, -apple-system, sans-serif";
Chart.defaults.color = '#4a5266';

const TYPES: { v: ChartType; l: string }[] = [
  { v: 'bar', l: 'Barras' }, { v: 'line', l: 'Líneas' }, { v: 'pie', l: 'Torta' }, { v: 'doughnut', l: 'Dona' },
];
const ROW_H = 24, COL_W = 100, HEAD_W = 46, HEAD_H = 24;

function buildConfig(ch: ChartData) {
  const s = readSeries(ch.sheetId, ch.range);
  const round = ch.type === 'pie' || ch.type === 'doughnut';
  const datasets = s.datasets.map((d, i) => {
    const color = PALETTE[i % PALETTE.length];
    return round
      ? { ...d, backgroundColor: s.labels.map((_, j) => PALETTE[j % PALETTE.length]), borderColor: '#fff', borderWidth: 2 }
      : { ...d, backgroundColor: ch.type === 'line' ? color + '22' : color, borderColor: color, borderWidth: ch.type === 'line' ? 2.5 : 0,
          borderRadius: ch.type === 'bar' ? 4 : 0, tension: 0.3, pointRadius: 3, fill: ch.type === 'line' && s.datasets.length === 1 };
  });
  return {
    type: ch.type,
    data: { labels: s.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: {
        legend: { display: round || s.datasets.length > 1, position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmtValue(Number(c.raw ?? 0), c.dataset.fmt ?? 'number')}` } },
      },
      scales: round ? {} : {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#eef0f3' }, ticks: { callback: (v: any) => fmtAxis(Number(v), s.datasets[0]?.fmt ?? 'number') } },
      },
    },
  } as any;
}

function ChartCard({ ch, version }: { ch: ChartData; version: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const [box, setBox] = useState({ x: ch.x, y: ch.y, w: ch.w, h: ch.h });
  const drag = useRef<null | { mode: 'move' | 'size'; sx: number; sy: number; b: typeof box }>(null);
  const boxRef = useRef(box); boxRef.current = box;

  useEffect(() => { if (!drag.current) setBox({ x: ch.x, y: ch.y, w: ch.w, h: ch.h }); }, [ch.x, ch.y, ch.w, ch.h]);

  // crear/recrear al cambiar el tipo
  useEffect(() => {
    if (!canvas.current) return;
    chart.current = new Chart(canvas.current, buildConfig(ch));
    return () => { chart.current?.destroy(); chart.current = null; };
  }, [ch.type]);

  // actualizar datos en vivo
  useEffect(() => {
    const c = chart.current; if (!c) return;
    const cfg = buildConfig(ch);
    c.data = cfg.data; c.options = cfg.options; c.update();
  }, [version, ch.range, ch.title]);

  const start = (mode: 'move' | 'size') => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('select,button')) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, b: box };
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return; const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
      setBox(d.mode === 'move'
        ? { ...d.b, x: Math.max(0, d.b.x + dx), y: Math.max(0, d.b.y + dy) }
        : { ...d.b, w: Math.max(240, d.b.w + dx), h: Math.max(180, d.b.h + dy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      drag.current = null;
      const b = boxRef.current;
      S.updateChart(ch.id, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div className="as-chart" data-chart-id={ch.id} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div className="as-chart-head" onPointerDown={start('move')}>
        <input className="as-chart-title" value={ch.title} onChange={e => S.updateChart(ch.id, { title: e.target.value })}
          onPointerDown={e => e.stopPropagation()} title="Título" />
        <select value={ch.type} onChange={e => S.updateChart(ch.id, { type: e.target.value as ChartType })} title="Tipo de gráfico">
          {TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        <button className="as-chart-close" onClick={() => S.removeChart(ch.id)} title="Eliminar gráfico">×</button>
      </div>
      <div className="as-chart-sub">{ch.range}</div>
      <div className="as-chart-body"><canvas ref={canvas} /></div>
      <div className="as-chart-resize" onPointerDown={start('size')} />
    </div>
  );
}

export function createChartFromSelection(): ChartData | null {
  const sel = S.getSelection();
  const sheetId = sel?.sheetId || S.getSheet().id;
  let g: { r1: number; c1: number; r2: number; c2: number } | null = sel ? { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 } : null;
  if (!g || (g.r1 === g.r2 && g.c1 === g.c2)) g = S.usedRange(sheetId) ?? g;
  if (!g) return null;
  const sh = S.getSheet(sheetId);
  let x = HEAD_W;
  for (let c = 0; c <= g.c2; c++) x += sh.colWidths?.[c] ?? COL_W;
  x += 24;
  const area = document.querySelector('.grid-area') as HTMLElement | null;
  const w = 440, h = 290;
  const scEl = document.querySelector('.grid-area .ag-scroll') as HTMLElement | null;
  const sx = scEl?.scrollLeft ?? 0, sy = scEl?.scrollTop ?? 0;
  let y = Math.max(HEAD_H + 8 + sy, HEAD_H + g.r1 * ROW_H);
  if (area && x + w + 16 > sx + area.clientWidth) {
    // No cabe a la derecha del rango: va debajo, sin tapar los datos
    x = Math.max(HEAD_W + 8, sx + 16);
    y = HEAD_H + (g.r2 + 2) * ROW_H;
  }
  const n = S.getWorkbook().charts.filter(c => c.sheetId === sheetId).length;
  return S.addChart({ sheetId, type: 'bar', range: rangeToA1(g), title: 'Gráfico ' + (n + 1), x: x + n * 20, y: y + n * 20, w, h });
}

// Sigue el scroll del grid para que los gráficos se muevan con las celdas.
function useGridScroll() {
  const [sc, setSc] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const read = () => {
      const el = document.querySelector('.grid-area .ag-scroll') as HTMLElement | null;
      if (el) setSc(p => (p.x === el.scrollLeft && p.y === el.scrollTop ? p : { x: el.scrollLeft, y: el.scrollTop }));
    };
    const on = (e: Event) => { if ((e.target as HTMLElement)?.classList?.contains('ag-scroll')) read(); };
    document.addEventListener('scroll', on, { capture: true, passive: true });
    read();
    return () => document.removeEventListener('scroll', on, { capture: true } as any);
  }, []);
  return sc;
}

export function ChartsLayer() {
  const version = useSyncExternalStore(S.subscribe, S.getVersion);
  const sc = useGridScroll();
  const slot = useToolbarSlot();
  const wb = S.getWorkbook();
  const charts = wb.charts.filter(c => c.sheetId === wb.activeSheetId);
  return (
    <>
      <div className="as-charts-layer">
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${-sc.x}px, ${-sc.y}px)` }}>
        {charts.map(ch => <ChartCard key={ch.id} ch={ch} version={version} />)}
        </div>
      </div>
      {slot && createPortal(
        <button className="as-tb-btn" onClick={() => createChartFromSelection()} title="Crear gráfico de barras desde la selección">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="8" width="3" height="7" fill="currentColor"/><rect x="6" y="4" width="3" height="11" fill="currentColor"/><rect x="11" y="1" width="3" height="14" fill="currentColor"/></svg>
          Gráfico
        </button>, slot)}
    </>
  );
}
