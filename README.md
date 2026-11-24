# AgentsSheet

Una hoja de cálculo tipo Excel, en español de Colombia, donde un agente de IA trabaja directamente sobre el grid. Le pides algo en lenguaje natural y lo ves escribir tablas, fórmulas, formatos, gráficos y macros en vivo. Todo se puede hacer también a mano.

## Cómo correrlo

Requisitos: Node 22 o superior y el CLI `claude` con sesión iniciada en el plan de suscripción (`claude auth status` debe decir `loggedIn: true`; si no, `claude auth login`).

```bash
npm install
npm start
```

- En el computador: http://localhost:5173
- Desde el celular o la tablet en la misma red Wi-Fi: http://IP-DEL-MAC:5173

No hay llave de API. El servidor usa el Claude Agent SDK, que lanza el `claude` local con tu sesión del plan, y borra `ANTHROPIC_API_KEY` del entorno por si existe.

## Cómo está hecho

| Pieza | Qué hace | Dónde |
|---|---|---|
| Store | El libro (hojas, celdas, estilos, gráficos, macros), deshacer por instantáneas, persistencia en el navegador, xlsx/csv | `src/core/` |
| Motor de fórmulas | HyperFormula en español: `SUMA`, `SI`, `SUMAR.SI`, `BUSCARV`, `BUSCARX`…, separador `;`, coma decimal, ciclos como `#CICLO!` | `src/core/store.ts` |
| Grid | Hoja virtualizada, selección, edición, atajos, copiar/pegar con Excel y Sheets, cinta, pestañas | `src/ui/grid/` |
| Gráficos | Tarjetas flotantes con Chart.js que se actualizan con los datos | `src/ui/charts/` |
| Macros | JavaScript sobre una API sencilla en español (`hoja.rango("A1:B3").formato({...})`) | `src/ui/macros/` (API en `API.md`) |
| Agente | Servidor Node con el Agent SDK y herramientas propias (MCP en proceso) que operan la hoja por WebSocket | `server/`, `src/agent/`, `src/ui/chat/` |

El navegador es la fuente de verdad. Cada herramienta del agente viaja por WebSocket al navegador, se aplica al store y devuelve el resultado; por eso el grid cambia mientras el agente trabaja. Cada petición al agente es una sola transacción de deshacer.

## Decisiones

Ver `docs/decisiones.md` y `docs/decisiones-agente.md`.
