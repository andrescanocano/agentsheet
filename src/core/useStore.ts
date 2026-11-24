import { useSyncExternalStore } from 'react';
import { subscribe, getVersion } from './store';
/** Re-renderiza el componente en cada cambio del libro. Devuelve la versión. */
export function useWorkbookVersion(): number { return useSyncExternalStore(subscribe, getVersion, getVersion); }
