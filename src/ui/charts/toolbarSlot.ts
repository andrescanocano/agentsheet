// Busca el <div id="toolbar-extra" /> que deja GRID en el Toolbar. Reintenta hasta que exista.
import { useEffect, useState } from 'react';

export function useToolbarSlot(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(() => document.getElementById('toolbar-extra'));
  useEffect(() => {
    const t = setInterval(() => {
      const cur = document.getElementById('toolbar-extra');
      setEl(prev => (prev === cur ? prev : cur));
    }, 300);
    return () => clearInterval(t);
  }, []);
  return el;
}
