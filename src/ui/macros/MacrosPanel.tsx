// Panel de macros: lista, editor, guardar, ejecutar, eliminar. Botón "Macros" en el toolbar.
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import * as S from '../../core/store';
import { runMacroCode, EXAMPLE_MACRO, NEW_MACRO_TEMPLATE, type MacroResult } from './runtime';
import { useToolbarSlot } from '../charts/toolbarSlot';
import './macros.css';

export function MacrosPanel() {
  useSyncExternalStore(S.subscribe, S.getVersion);
  const slot = useToolbarSlot();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [code, setCode] = useState('');
  const [out, setOut] = useState<MacroResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const macros = S.getWorkbook().macros;

  const load = (m?: { id?: string; name: string; code: string; description?: string }) => {
    setId(m?.id); setName(m?.name ?? ''); setDesc(m?.description ?? ''); setCode(m?.code ?? ''); setOut(null); setDirty(false);
  };
  const openPanel = () => { setOpen(true); if (!id && !name) { const first = S.getWorkbook().macros[0]; first ? load(first) : load({ name: 'NuevaMacro', code: NEW_MACRO_TEMPLATE }); } };
  const save = () => {
    const n = name.trim() || 'Macro' + (macros.length + 1);
    const m = S.saveMacro({ id, name: n, code, description: desc });
    setId(m.id); setName(m.name); setDirty(false);
    return m;
  };
  const run = () => {
    const label = 'Macro: ' + (name.trim() || 'sin nombre');
    if (dirty || !id) save();
    setOut(runMacroCode(code, label));
  };
  const remove = () => {
    if (!id) { load({ name: 'NuevaMacro', code: NEW_MACRO_TEMPLATE }); return; }
    if (!confirm(`¿Eliminar la macro "${name}"?`)) return;
    S.deleteMacro(id);
    const rest = S.getWorkbook().macros;
    rest.length ? load(rest[0]) : load({ name: 'NuevaMacro', code: NEW_MACRO_TEMPLATE });
  };
  const insertExample = () => {
    const existing = S.getWorkbook().macros.find(m => m.name === EXAMPLE_MACRO.name);
    load(existing ?? S.saveMacro({ ...EXAMPLE_MACRO }));
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.currentTarget, s = t.selectionStart, en = t.selectionEnd;
      const v = code.slice(0, s) + '  ' + code.slice(en);
      setCode(v); setDirty(true);
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };

  return (
    <>
      {slot && createPortal(
        <button className="as-tb-btn" onClick={() => (open ? setOpen(false) : openPanel())} title="Macros del libro">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 4 1 8l4 4M11 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>
          Macros
        </button>, slot)}
      {open && (
        <div className="as-mac-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="as-mac" role="dialog" aria-label="Macros">
            <div className="as-mac-head">
              <strong>Macros</strong>
              <span className="as-mac-hint">JavaScript sobre la API en español · Ctrl/Cmd+Enter ejecuta</span>
              <button className="as-mac-x" onClick={() => setOpen(false)} title="Cerrar">×</button>
            </div>
            <div className="as-mac-body">
              <aside className="as-mac-list">
                {macros.map(m => (
                  <button key={m.id} className={'as-mac-item' + (m.id === id ? ' on' : '')} onClick={() => load(m)} title={m.description}>{m.name}</button>
                ))}
                {!macros.length && <div className="as-mac-empty">Sin macros todavía</div>}
                <div className="as-mac-listbtns">
                  <button onClick={() => load({ name: 'NuevaMacro', code: NEW_MACRO_TEMPLATE })}>+ Nueva macro</button>
                  <button onClick={insertExample}>Insertar ejemplo</button>
                </div>
              </aside>
              <section className="as-mac-edit">
                <div className="as-mac-fields">
                  <input value={name} onChange={e => { setName(e.target.value); setDirty(true); }} placeholder="Nombre" aria-label="Nombre de la macro" />
                  <input value={desc} onChange={e => { setDesc(e.target.value); setDirty(true); }} placeholder="Descripción" aria-label="Descripción" />
                </div>
                <textarea className="as-mac-code" value={code} spellCheck={false} onKeyDown={onKey}
                  onChange={e => { setCode(e.target.value); setDirty(true); }} aria-label="Código de la macro" />
                <div className="as-mac-actions">
                  <button className="primary" onClick={run}>▶ Ejecutar</button>
                  <button onClick={save}>Guardar{dirty ? ' •' : ''}</button>
                  <button className="danger" onClick={remove}>Eliminar</button>
                </div>
                <pre className={'as-mac-out' + (out && !out.ok ? ' err' : '')}>
                  {out ? [...out.log, out.ok ? '✓ Terminó. Se deshace con Ctrl+Z en un solo paso.' : '✗ ' + out.error].join('\n') : 'La salida de log() aparece aquí.'}
                </pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
