# Decisiones (reto de 1 hora, 24-nov-2026)

1. **Grid propio + HyperFormula.** Handsontable o Univer traen más cosas hechas, pero esas cosas son difíciles de operar desde el agente y de deshacer en bloque. HyperFormula trae el grafo de dependencias, la detección de ciclos y el idioma español. Su licencia es GPL v3: sirve para una demo, no para un producto cerrado.
2. **El navegador es la fuente de verdad.** El servidor no guarda el libro. Las herramientas del agente se ejecutan en el navegador, y así los cambios se ven en vivo y sin sincronizar dos copias.
3. **Deshacer por instantáneas.** Cada cambio guarda una copia del libro. Para hojas de demo cuesta poco y es a prueba de errores. Una petición al agente o una macro es una sola transacción: un Ctrl+Z la revierte entera.
4. **Macros en JavaScript**, no en VBA. Corren sobre una API corta en español (`libro`, `hoja`, `rango`, `celda`, `log`), se guardan con el libro y se ejecutan desde el panel de Macros o por el agente.
5. **Modelo por defecto: Sonnet 5.5**, por velocidad en vivo. En el panel se puede cambiar a Opus 5.5.
6. **CSV con `;` y coma decimal**, que es lo que abre Excel en Colombia. El xlsx exporta las fórmulas traducidas al inglés, porque así las guarda el formato.
7. **Persistencia en `localStorage`** del navegador. Cada dispositivo tiene su propio libro.
8. **Publicación en GitHub Pages** solo de la hoja, sin agente: el agente necesita el `claude` local con sesión.
9. **Al ordenar**, las fórmulas que apuntan a su propia fila se ajustan. Las que cruzan filas dentro del rango ordenado pueden desalinearse (limitación aceptada).
