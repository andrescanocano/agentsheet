import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __PAGES__: JSON.stringify(mode === 'pages') }, // build de GitHub Pages: sin agente
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
}));
