import { useEffect, useState } from 'react';
import * as S from '../../core/store';
import { useStoreVersion, focusGrid } from './Grid';
import { getEdit, commitEdit, select } from './gridState';
import './grid.css';

export function SheetTabs() {
  useStoreVersion();
  const wb = S.getWorkbook();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<null | { id: string; x: number; y: number }>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close); window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); };
  }, [menu]);

  const activate = (id: string) => {
    const e = getEdit();
    if (e.editing && !e.value.startsWith('=')) commitEdit();
    if (wb.activeSheetId !== id) {
      S.setActiveSheet(id);
      if (!getEdit().editing) select(id, 0, 0, 0, 0);
    }
  };
  const doRename = (id: string) => {
    const n = draft.trim();
    if (n && n !== S.getSheet(id).name) {
      try { S.renameSheet(id, n); } catch (err) { alert((err as Error).message); }
    }
    setRenaming(null); focusGrid();
  };
  const doDelete = (id: string) => {
    setMenu(null);
    if (wb.sheets.length <= 1) { alert('El libro debe tener al menos una hoja.'); return; }
    if (confirm(`¿Eliminar la hoja «${S.getSheet(id).name}»?`)) { try { S.deleteSheet(id); } catch (err) { alert((err as Error).message); } }
  };

  return (
    <div className="ag-tabs" role="tablist">
      {wb.sheets.map((sh) => (
        <div key={sh.id} role="tab" aria-selected={sh.id === wb.activeSheetId} className={'ag-tab' + (sh.id === wb.activeSheetId ? ' active' : '')}
          onClick={() => activate(sh.id)}
          onDoubleClick={() => { setRenaming(sh.id); setDraft(sh.name); }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ id: sh.id, x: e.clientX, y: e.clientY - 80 }); }}>
          {renaming === sh.id ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onBlur={() => doRename(sh.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') doRename(sh.id); else if (e.key === 'Escape') { setRenaming(null); focusGrid(); } }}
              onClick={(e) => e.stopPropagation()} onFocus={(e) => e.target.select()} />
          ) : sh.name}
        </div>
      ))}
      <button className="ag-tab-add" title="Nueva hoja" onClick={() => { const sh = S.addSheet(); S.setActiveSheet(sh.id); select(sh.id, 0, 0, 0, 0); focusGrid(); }}>+</button>
      {menu && (
        <div className="ag-menu" style={{ left: menu.x, top: Math.max(4, menu.y) }} onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => { const sh = S.getSheet(menu.id); setRenaming(menu.id); setDraft(sh.name); setMenu(null); }}>Cambiar nombre</button>
          <button className="danger" onClick={() => doDelete(menu.id)}>Eliminar hoja</button>
        </div>
      )}
    </div>
  );
}
