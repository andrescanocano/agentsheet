# Decisiones del agente de AgentsSheet

## Autenticación (verificado el 2026-11-24)

- El Agent SDK lanza el CLI `claude` y hereda su credencial. Sin `ANTHROPIC_API_KEY`, el CLI usa el login de suscripción (`/login`); el mensaje `init` lo reporta como `apiKeySource: "none"` (claude.ai OAuth). Fuente: [Authentication](https://code.claude.com/docs/en/authentication) y el tipo `SDKSystemMessage` del paquete.
- Términos: el OAuth de claude.ai es para quien compra el plan (Pro/Max) y Anthropic no permite que terceros ofrezcan el login de claude.ai en sus productos; para productos recomiendan llave de API. Los límites de Max asumen "ordinary, individual usage of Claude Code and the Agent SDK". Fuentes: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) y [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).
- Lectura: uso personal y local de el usuario, con su propio plan, encaja en el uso individual. Si AgentsSheet se ofreciera a terceros, tendría que pasar a llave de API.

## Cómo queda en el código

- `server/agent.ts` y `server/index.ts` borran `ANTHROPIC_API_KEY` y `ANTHROPIC_AUTH_TOKEN` del proceso, y al CLI hijo no le pasan variables `CLAUDE_CODE_*` del host de escritorio.
- `pathToClaudeCodeExecutable` = el binario local de claude (`CLAUDE_BIN`, o `which claude`).
- El CLI local debe tener sesión: `claude auth status` debe decir `"loggedIn": true`. Si no, el usuario corre `claude auth login` en la Terminal (una vez).
- Herramientas: solo las del MCP en proceso `sheet` (`tools: []` quita Bash, Write, Edit, WebFetch, etc.). `fetch_url` corre en el servidor; todo lo demás se reenvía al navegador por `/ws`.
- Modo Preguntar: la aprobación se pide dentro del handler de cada herramienta que modifica (más fiable que `canUseTool`, que solo se invoca cuando el flujo de permisos cae en prompt).
- Prueba aislada: `npx tsx server/test-sdk.ts`.
