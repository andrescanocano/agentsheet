# API de macros de AgentsSheet

Las macros son JavaScript síncrono. Toda la macro corre en una transacción: Ctrl+Z la deshace de un golpe.
Ejecutar desde código: `runMacroCode(code)` o `runMacro(idONombre)` en `src/ui/macros/runtime.ts`
(también en `window.__macros`). Devuelven `{ ok, log, error? }`.

## Variables disponibles
- `libro` — el libro. `hoja` — la hoja activa (igual a `libro.hoja()`).
- `log(...args)` — escribe en el log. `alerta(msg)` — igual, marcado con ⚠.
- `return` termina la macro.

## libro
- `libro.hoja(nombre?)` → Hoja (sin nombre = activa; error si no existe).
- `libro.hojas()` → `["Hoja1", ...]`. `libro.agregarHoja(nombre)` → Hoja.

## Hoja
- `.nombre`, `.activar()`
- `.rango("A1:C5")` → Rango. `.celda("B2")` → Celda. `.usado()` → Rango del área con datos.
- `.buscar(texto)` → `Celda[]` que contienen el texto (máx. 50, sin distinguir mayúsculas).
- `.ordenar("A1:D20", "C", asc = true, conEncabezado?)` — `conEncabezado` se detecta solo si se omite.

## Rango
- `.direccion` ("A1:C5"), `.filas`, `.columnas`
- `.valores` → matriz de valores calculados (número, texto, booleano, null; errores como "#DIV/0!").
  `.valores = [[...], ...]` escribe desde la esquina superior izquierda, en un solo lote.
- `.formulas` → matriz de entradas crudas. `.formulas = [["=SUMA(A1:A3)"]]` (fórmulas en español, separador `;`).
- `.celda(i, j)` → Celda relativa al rango, base 0 (`celda(0,0)` es la esquina).
- `.formato(estilo)`, `.limpiar(que = 'all' | 'contents' | 'formats')`
- `.cadaCelda(c => { ... })` — las escrituras `c.valor = x` se aplican en un lote al final del recorrido.

## Celda
- `.valor` (get/set), `.formula` (get/set), `.texto` (como se ve), `.fila` (1, 2, ...), `.col` ("B"), `.direccion` ("B2")
- `.formato(estilo)`, `.limpiar()`

## estilo
`{ bold, italic, underline, color: '#c00', bg: '#ffeb9c', align: 'left'|'center'|'right', border: true,
   numFmt: 'cop'|'percent'|'number'|'integer'|'date'|'general', decimals: 0 }`

## Ejemplos
```js
// Encabezado en negrita con fondo y formato COP en la columna C
hoja.rango("A1:D1").formato({ bold: true, bg: '#e8f3ec' });
hoja.rango("C2:C50").formato({ numFmt: 'cop', decimals: 0 });

// Escribir una tabla en lote y un total con fórmula
hoja.rango("F1:G3").valores = [["Mes", "Ventas"], ["Enero", 1200000], ["Febrero", 980000]];
hoja.celda("G4").formula = "=SUMA(G2:G3)";

// IVA del 19 % en la columna E a partir de la D
const u = hoja.usado();
for (let i = 1; i < u.filas; i++) hoja.celda("E" + (i + 1)).formula = `=D${i + 1}*19%`;

// Marcar en rojo los negativos
hoja.usado().cadaCelda(c => { if (typeof c.valor === 'number' && c.valor < 0) c.formato({ color: '#c0392b' }); });

// Ordenar por la columna C de mayor a menor
hoja.ordenar("A1:D20", "C", false);
```

Ejemplo incluido: **ResaltarTotalesMayores** (botón "Insertar ejemplo"): resalta en amarillo y negrita
los valores > $ 1.000.000 de la columna cuyo encabezado contiene "Total".
