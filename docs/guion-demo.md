# Guion de demo (3 minutos)

Antes de empezar: `npm start`, abrir http://localhost:5173 con la hoja en blanco (si no, «Nuevo libro»). Chat en modo **Autónomo**, modelo Sonnet. En el celular, la misma app en http://IP-DEL-MAC:5173.

**0:00 · Qué es (15 s).** «Esto es Excel, en español de Colombia, pero el protagonista es un agente. Yo le pido cosas y él trabaja sobre la hoja, en vivo.»

**0:15 · Crear (35 s).** Clic en el chip «Tabla de ventas de ejemplo». Mientras escribe: «Miren el grid: está escribiendo fórmulas de verdad, no valores pegados». Clic en una celda del resumen y mostrar `=SUMAR.SI(...)` en la barra de fórmulas.

**0:50 · Analizar y graficar (25 s).** «¿Qué región vendió más? Hazme un gráfico.» Responde con la cifra y aparece el gráfico. Cambiar un precio a mano y ver cómo se mueven el total y la barra.

**1:15 · Impuestos (20 s).** «Agrega una columna con el IVA del 19 % y formatea todo en pesos.» Señalar el formato `$ 1.234.567,00`.

**1:35 · Deshacer de un golpe (15 s).** Clic en «Deshacer todo lo del agente»: la columna de IVA desaparece entera. Ctrl+Y para recuperarla.

**1:50 · Macro (25 s).** «Escribe una macro que resalte los totales mayores a 1 millón y ejecútala.» Abrir el panel Macros y mostrar el código guardado con el libro.

**2:15 · Datos de afuera (25 s).** «Trae los datos de /demo/precios.csv y crúzalos con la tabla usando BUSCARV.» Mostrar la hoja nueva y la fórmula `=BUSCARV(...;FALSO)`.

**2:40 · Control (20 s).** Cambiar a «Preguntar antes de aplicar», pedir «pon los encabezados en azul» y aprobar la tarjeta. Cerrar con: «El agente propone y yo decido. Y todo lo puedo hacer también a mano: es una hoja de cálculo de verdad.» Exportar a .xlsx y abrirlo en Excel si da el tiempo.

**Respaldo si algo falla:** «¿Por qué sale #N/A?» sobre un BUSCARV de un producto inexistente. Es rápido y siempre funciona.
